// R8-56 answer actions: save as note (in the scope's space, folder "Q&A", question as a callout, source links),
// append to a note, make flashcards, share. Saved state is kept per message so the "Saved as …" banner and the
// header button agree.
import { useSyncExternalStore } from "react";
import type { ChatMessage, ChatThread, Note } from "../../../shared/types";
import { createFolder, createNote, updateNote } from "../../lib/actions";
import { aiRun, getToken } from "../../lib/api";
import { answerMarkdown, citedIn } from "../../lib/chat";
import { db, DEMO } from "../../lib/db";
import { t } from "../../lib/i18n";
import { openNote, toast, type Vault } from "../../lib/store";

export interface SavedInfo { noteId: string; title: string; where: string; links: number }
let saved: Record<string, SavedInfo> = {};
const subs = new Set<() => void>();
export const useSaved = () => useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => saved);
const mark = (id: string, s: SavedInfo) => { saved = { ...saved, [id]: s }; subs.forEach((f) => f()); };

const clean = (s: string) => s.replace(/[#[\]|\\/:*?"<>]/g, " ").replace(/\s+/g, " ").trim();
export const questionOf = (thread: ChatThread, m: ChatMessage) => {
  const i = thread.messages.indexOf(m);
  return [...thread.messages.slice(0, i < 0 ? thread.messages.length : i)].reverse().find((x) => x.role === "user")?.text ?? "";
};
/** Space the answer is filed in: the thread's scope space (or its note's / folder's), else the Inbox. */
function homeSpace(thread: ChatThread, v: Vault, note?: Note) {
  const s = thread.scope;
  const id = s.spaceId ?? (s.folderId ? v.folderMap.get(s.folderId)?.spaceId : undefined) ?? (s.noteId ? v.byId.get(s.noteId)?.spaceId : undefined) ?? note?.spaceId ?? "inbox";
  return v.spaceMap.get(id) ? id : "inbox";
}

export async function saveAnswerAsNote(thread: ChatThread, m: ChatMessage, v: Vault, note?: Note): Promise<SavedInfo | null> {
  if (saved[m.id]) { openNote(saved[m.id].noteId); return saved[m.id]; }
  const q = questionOf(thread, m);
  const title = clean(q).slice(0, 90) || thread.title;
  const spaceId = homeSpace(thread, v, note);
  const space = v.spaceMap.get(spaceId);
  let folder = v.folders.find((f) => f.spaceId === spaceId && !f.parentId && f.name === "Q&A" && !f.deleted);
  if (!folder && spaceId !== "inbox") folder = await createFolder(spaceId, null, "Q&A");
  const used = citedIn(m.text);
  const links = (m.sources ?? []).filter((s) => !used.size || used.has(s.n)).length;
  const body = `# ${title}\n\n> [!question] ${q.replace(/\n/g, " ")}\n\n${answerMarkdown(m)}`;
  const n = await createNote({ title, spaceId, folderId: folder?.id ?? null, body });
  const info = { noteId: n.id, title: `${title}.md`, where: [space?.name ?? t("Inbox"), folder?.name].filter(Boolean).join(" / "), links };
  mark(m.id, info);
  toast(t("Saved as a note"), { label: t("Open"), run: () => openNote(n.id) });
  return info;
}

export async function appendAnswerToNote(thread: ChatThread, m: ChatMessage, target: Note) {
  const q = questionOf(thread, m);
  const add = `\n\n> [!question] ${q.replace(/\n/g, " ")}\n\n${answerMarkdown(m)}`;
  const cur = await db.notes.get(target.id);
  if (!cur) return;
  await updateNote(target.id, { body: cur.body.replace(/\s+$/, "") + add });
  toast(t("Added to {title}", { title: target.title }), { label: t("Open"), run: () => openNote(target.id) });
}

export async function makeCards(thread: ChatThread, m: ChatMessage, v: Vault, note?: Note, count = 5): Promise<boolean> {
  const q = questionOf(thread, m);
  const plain = m.text.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\*\*[^*]+\*\*/g, "");
  let out = "";
  try {
    if (DEMO && !getToken()) out = plain.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^[-*\s]+/, "").trim()).filter((s) => s.length > 12).slice(0, count).map((s, i) => `${q.replace(/[?؟]$/, "")} (${i + 1})? :: ${s.replace(/[*_]/g, "")}`).join("\n");
    else out = (await aiRun("flashcards", `${q}\n\n${plain}`)).trim();
  } catch (e) { toast((e as Error).message); return false; }
  const cards = out.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim()).filter((l) => / :: /.test(l)).slice(0, count);
  if (!cards.length) { toast(t("The AI didn't return any cards.")); return false; }
  const title = `${clean(q).slice(0, 80) || thread.title} · cards`;
  const from = (m.sources ?? []).filter((s) => citedIn(m.text).has(s.n)).map((s) => `[[${s.title.replace(/[[\]|#]/g, " ")}]]`).filter((x, i, a) => a.indexOf(x) === i);
  const n = await createNote({ title, spaceId: homeSpace(thread, v, note), type: "flashcards", body: `# ${title}\n\n${cards.join("\n")}\n${from.length ? `\nFrom ${from.join(", ")}\n` : ""}` });
  toast(t("{n} flashcard made (it shows in Review)|{n} flashcards made (they show in Review)", { n: cards.length }), { label: t("Open"), run: () => openNote(n.id) });
  return true;
}

/** Share = the conversation as Markdown on the clipboard. */
export async function shareThread(md: string) {
  try { await navigator.clipboard.writeText(md); toast(t("Conversation copied")); } catch { toast(t("Couldn't copy")); }
}
