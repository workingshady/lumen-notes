// Automatic versions (Settings › Versions & history › "Automatic named versions", design 58H). Each trigger saves the
// note as a version just before something big happens to it, when its switch is on (lib/version-prefs.ts).
//   restore  – restoreFromVersion (components/versions/vs-util.ts)         ai      – Assistant "add to note" (autoVersion call)
//   paste    – a 500+ word paste into the editor (watchVersions below)     daily   – one version of every changed note after 03:00
//   convert / plan – autoVersion("convert"|"plan", note) for callers that change a note in place.
import type { Note } from "../../shared/types";
import { snapshot } from "./actions";
import { db, getMeta, setMeta } from "./db";
import { t } from "./i18n";
import { getUI } from "./store";
import { autoVersionOn } from "./version-prefs";

const LABEL: Record<string, string> = { ai: "Before AI edit", restore: "Before restore", convert: "Before converting", plan: "Before marking a topic done", paste: "Before a big paste" };

/** Save `note` (its current stored text) as a "Before …" version unless the latest version already has this text. */
export async function autoVersion(id: keyof typeof LABEL, note: Note | string): Promise<boolean> {
  if (!autoVersionOn(id)) return false;
  const n = typeof note === "string" ? await db.notes.get(note) : note;
  if (!n || n.deleted) return false;
  const last = (await db.versions.where("noteId").equals(n.id).filter((v) => !v.deleted).toArray()).reduce<{ body: string; createdAt: number } | null>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), null);
  if (last?.body === n.body) return false;
  await snapshot(n, LABEL[id]);
  return true;
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;
export const BIG_PASTE_WORDS = 500;

/** Daily snapshot: after 03:00, once a day, every text note changed since its latest version gets an (unlabelled) version. */
export async function dailySnapshot(at = new Date()): Promise<number> {
  if (!autoVersionOn("daily") || at.getHours() < 3) return 0;
  const day = at.toDateString();
  if ((await getMeta<string>("vaultSnapshotDay", "")) === day) return 0;
  await setMeta("vaultSnapshotDay", day);
  let n = 0;
  for (const note of await db.notes.filter((x) => !x.deleted && !["canvas", "whiteboard", "board"].includes(x.type) && x.body.length < 400_000).toArray()) {
    const latest = (await db.versions.where("noteId").equals(note.id).filter((v) => !v.deleted).toArray()).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest && latest.body === note.body) continue;
    if (!latest && !note.body.trim()) continue;
    await snapshot(note, "");
    n++;
  }
  return n;
}

let watching = false;
/** Start the paste watcher and the daily snapshot timer (once; called by the conflict host that is mounted all the time). */
export function watchVersions() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  // Capture phase: runs before the editor applies the paste, so the stored note is still the text from before it.
  document.addEventListener("paste", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(".cm-editor, textarea, [contenteditable=true]")) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (text.length < BIG_PASTE_WORDS * 3 || wordCount(text) < BIG_PASTE_WORDS) return;
    const id = getUI().noteId;
    if (id) void autoVersion("paste", id).then(async (saved) => { if (saved) (await import("./store")).toast(t("Saved a version before the big paste")); });
  }, true);
  const tick = () => { void dailySnapshot().catch(() => { /* never breaks the app */ }); };
  setTimeout(tick, 20_000);
  setInterval(tick, 30 * 60_000);
}
