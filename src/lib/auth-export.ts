// Accounts: "Export all my data" (design 27M/27N: ".zip with every note, file, card and setting"). docs/ACCOUNTS.md
// The zip holds:
//   account.json        profile, sign-in methods, sessions and the security log (server: GET /api/auth/export,
//                       which also lists every synced record of this account under `items`)
//   notes/<title>.md    every note on this device as Markdown (front matter included; same writer as the vault export)
//   attachments/…       every file stored on this device
//   data/<table>.json   every local table: notes, folders, spaces, cards, reviews, sessions, chats, versions…
//   settings.json       this device's settings
// In the demo preview the server part is the preview's stand-in profile; nothing is sent anywhere.
import type { Note } from "../../shared/types";
import { getToken, API_BASE } from "./api";
import { accountsPreview, authApi, AuthError, AUTH_TEXT, isSessionToken, type AuthSession, type AuthUser } from "./auth";
import { db } from "./db";
import { download, noteToMarkdown } from "./io";

const safe = (s: string) => (s || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "Untitled";

async function serverPart(): Promise<unknown> {
  if (accountsPreview) {
    const [{ user }, { sessions }] = await Promise.all([authApi<{ user: AuthUser }>("/auth/me"), authApi<{ sessions: AuthSession[] }>("/auth/sessions")]);
    return { format: "lumen-account-export", version: 1, exportedAt: new Date().toISOString(), preview: true, user, sessions, security: [], items: [] };
  }
  const tok = getToken();
  let r: Response;
  try { r = await fetch(API_BASE + "/api/auth/export", { headers: isSessionToken(tok) ? { authorization: `Bearer ${tok}` } : {} }); }
  catch { throw new AuthError(AUTH_TEXT.network, 0, {}); }
  if (!r.ok) throw new AuthError(r.status === 401 ? "You're signed out. Sign in again." : AUTH_TEXT.network, r.status, {});
  return r.json();
}

/** Builds the zip and downloads it. Returns the file name and the counts (for the toast). */
export async function downloadAccountZip(): Promise<{ file: string; notes: number; files: number }> {
  const [{ default: JSZip }, account] = await Promise.all([import("jszip"), serverPart()]);
  const zip = new JSZip();
  zip.file("account.json", JSON.stringify(account, null, 2));
  const notes = (await db.notes.toArray()).filter((n: Note) => !n.deleted);
  const used = new Set<string>();
  for (const n of notes) {
    let name = safe(n.title);
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safe(n.title)} ${i}`;
    used.add(name.toLowerCase());
    zip.file(`notes/${name}.md`, noteToMarkdown(n));
  }
  let files = 0;
  const metas = new Map((await db.attachments.toArray()).map((a) => [a.id, a]));
  await db.blobs.each((b) => {
    const meta = metas.get(b.id);
    if (meta?.deleted) return;
    zip.file(`attachments/${b.id}-${safe(meta?.name ?? "file")}`, b.blob);
    files++;
  });
  for (const table of db.tables) {
    if (table.name === "blobs") continue;
    zip.file(`data/${table.name}.json`, JSON.stringify(await table.toArray(), null, 1));
  }
  try { zip.file("settings.json", localStorage.getItem("lumen.settings") ?? "{}"); } catch { /* private mode */ }
  const out = await zip.generateAsync({ type: "blob" });
  const file = `lumen-account-${new Date().toISOString().slice(0, 10)}.zip`;
  download(file, out, "application/zip");
  return { file, notes: notes.length, files };
}
