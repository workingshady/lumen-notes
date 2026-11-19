// Small shared bits for the home area: app version, last-sync time, avatar image, dashboard layout, quick capture.
import { useSyncExternalStore } from "react";
import pkgRaw from "../../package.json?raw";
import { createNote, dailyNote, findOrCreateByTitle, updateNote } from "./actions";
import { db, DEFAULT_SPACE, patch } from "./db";
import { getSettings, setSettings, useSettings, type Settings } from "./settings";
import { toast } from "./store";
import { fmtDate, t } from "./i18n";

export const APP_VERSION: string = (() => { try { return (JSON.parse(pkgRaw) as { version: string }).version; } catch { return "0.0.0"; } })();

// ------------------------------------------------------------------ last sync (persisted across launches)
// sync.ts writes meta "cursor" after every successful pull; hook that write and remember the time.
const LAST_SYNC = "lumen.lastSync";
const stamp = () => { try { localStorage.setItem(LAST_SYNC, String(Date.now())); } catch { /* ignore */ } };
db.meta.hook("creating", (_pk, obj) => { if ((obj as { k: string }).k === "cursor") stamp(); });
db.meta.hook("updating", (_m, pk) => { if (pk === "cursor") stamp(); });
export const lastSyncAt = () => { try { return Number(localStorage.getItem(LAST_SYNC)) || 0; } catch { return 0; } };
/** "Tue 22:10", "today 09:12" style label for the unlock card. */
export function syncLabel(ts: number) {
  const d = new Date(ts), now = new Date();
  const hm = fmtDate(d, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return t("today {time}", { time: hm });
  if (now.getTime() - ts < 6 * 86_400_000) return `${fmtDate(d, { weekday: "short" })} ${hm}`;
  return `${fmtDate(d, { day: "numeric", month: "short" })} ${hm}`;
}

// ------------------------------------------------------------------ avatar image (synced via Inbox props)
type WithImg = Settings & { avatarImage?: string };
export const useAvatarImage = () => (useSettings() as WithImg).avatarImage ?? "";
export async function setAvatarImage(dataUrl: string) {
  setSettings({ avatarImage: dataUrl } as Partial<Settings>);
  const inbox = await db.spaces.get(DEFAULT_SPACE);
  if (inbox && (inbox.props?.avatarImage ?? "") !== dataUrl) await patch("space", DEFAULT_SPACE, { props: { ...inbox.props, avatarImage: dataUrl } });
}
/** Pull a synced avatar image from another device into local settings. */
export async function pullAvatarImage() {
  const img = (await db.spaces.get(DEFAULT_SPACE))?.props?.avatarImage ?? "";
  if (img !== ((getSettings() as WithImg).avatarImage ?? "")) setSettings({ avatarImage: img } as Partial<Settings>);
}
/** Center-crop to a square and resize to 256 px; returns a JPEG data URL (~15–30 KB). */
export async function cropAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.86);
}
/** Opens a file picker and stores the cropped image. */
export function pickAvatar(capture = false) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  if (capture) inp.setAttribute("capture", "user");
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try { await setAvatarImage(await cropAvatar(f)); } catch { toast(t("Couldn't read that image.")); }
  };
  inp.click();
}

// ------------------------------------------------------------------ dashboard layout (Customize home)
export type SectionId = "today" | "due" | "progress" | "activity" | "continue" | "pinned";
/** `name` / `hint` are getters: they read in the interface language. */
export const SECTIONS: { id: SectionId; name: string; hint: string }[] = [
  { id: "today", get name() { return t("Today"); }, get hint() { return t("Your study plan for the day"); } },
  { id: "due", get name() { return t("Due today"); }, get hint() { return t("Flashcards, tasks, notes to revisit"); } },
  { id: "progress", get name() { return t("Learning progress"); }, get hint() { return t("Status of your notes and courses"); } },
  { id: "activity", get name() { return t("Study activity"); }, get hint() { return t("Heatmap, streak, time this week"); } },
  { id: "continue", get name() { return t("Continue"); }, get hint() { return t("Recently edited notes"); } },
  { id: "pinned", get name() { return t("Pinned"); }, get hint() { return t("Notes you pinned"); } },
];
/** `custom` = the user reordered; until then phones use the design's phone order (Due, Continue, Activity). */
export type HomeLayout = { order: SectionId[]; hidden: SectionId[]; custom?: boolean };
const LAYOUT_KEY = "lumen.homeLayout";
const DEFAULT_LAYOUT: HomeLayout = { order: SECTIONS.map((s) => s.id), hidden: [] };
let layout: HomeLayout = (() => {
  try {
    const l = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as HomeLayout | null;
    if (!l) return DEFAULT_LAYOUT;
    const ids = SECTIONS.map((s) => s.id);
    const order = [...l.order.filter((x) => ids.includes(x)), ...ids.filter((x) => !l.order.includes(x))];
    return { order, hidden: l.hidden.filter((x) => ids.includes(x)), custom: !!l.custom };
  } catch { return DEFAULT_LAYOUT; }
})();
const lsubs = new Set<() => void>();
export const useHomeLayout = () => useSyncExternalStore((f) => (lsubs.add(f), () => lsubs.delete(f)), () => layout);
export function setHomeLayout(l: HomeLayout) {
  layout = l;
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch { /* ignore */ }
  lsubs.forEach((f) => f());
}
/** Design 3C order on phones (until the user reorders). */
export const PHONE_DEFAULT: SectionId[] = ["today", "due", "continue", "activity", "progress", "pinned"];
export const resetHomeLayout = () => setHomeLayout(DEFAULT_LAYOUT);

// ------------------------------------------------------------------ quick capture
const URL_RE = /^https?:\/\/\S+$/i;
const hhmm = () => new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const append = (body: string, line: string) => (body.replace(/\s+$/, "") + "\n" + line + "\n");

/**
 * Design 3A note 1: `- [ ]` makes a task, a pasted URL becomes a link card, `>` appends to today's daily note,
 * anything else becomes a new Inbox note (first line = title).
 */
export async function capture(text: string, spaceId: string): Promise<string> {
  const txt = text.trim();
  if (!txt) return "";
  const space = spaceId === "all" ? DEFAULT_SPACE : spaceId;
  if (txt.startsWith(">")) {
    const d = await dailyNote(space);
    await updateNote(d.id, { body: append(d.body, `- ${hhmm()} ${txt.slice(1).trim()}`) });
    return t("Added to today's daily note");
  }
  const task = /^(?:[-*]\s*)?\[\s?\]\s*(.+)$/s.exec(txt);
  if (task) {
    const n = await findOrCreateByTitle("Inbox tasks", space);
    const fresh = await db.notes.get(n.id);
    await updateNote(n.id, { body: append(fresh?.body ?? n.body, `- [ ] ${task[1].replace(/\n+/g, " ")}`) });
    return t("Task added to Inbox tasks");
  }
  if (URL_RE.test(txt)) {
    let title = txt;
    try { const u = new URL(txt); title = u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : ""); } catch { /* keep */ }
    const n = await createNote({ title: title.slice(0, 80), spaceId: space, body: `# ${title.slice(0, 80)}\n\n${txt}\n` });
    void import("./api").then(({ unfurl }) => unfurl(txt)).then((m) => { if (m?.title) void updateNote(n.id, { title: m.title.slice(0, 120), body: `# ${m.title.slice(0, 120)}\n\n${txt}\n` }); });
    return t("Link saved to Inbox");
  }
  const [first, ...rest] = txt.split("\n");
  const title = first.slice(0, 80);
  const more = rest.join("\n").trim() || (first.length > 80 ? first : "");
  await createNote({ title, body: `# ${title}\n\n${more}${more ? "\n" : ""}`, spaceId: space });
  return t("Saved to Inbox");
}
