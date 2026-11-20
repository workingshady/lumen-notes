// Shared helpers of the history panel and the version studio (design 58): time labels, what kind of version a row is,
// grouping quiet autosaves into sessions ("12 edits, 14:02 – 14:40") and the one "restore as new version".
import type { Note, Version } from "../../../shared/types";
import { snapshot, updateNote } from "../../lib/actions";
import { activityHint, charDelta } from "../../lib/activity";
import { autoVersion } from "../../lib/auto-versions";
import { fmtDate, t } from "../../lib/i18n";
import { toast } from "../../lib/store";

export const DAY = 86400000;
export const dayStart = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const hm = (ts: number) => fmtDate(ts, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "Yesterday 23:05", "Mon 20:18" (this week), "8 Nov 20:18". */
export function whenShort(ts: number) {
  const d0 = dayStart(Date.now());
  if (ts >= d0) return hm(ts);
  if (ts >= d0 - DAY) return t("Yesterday {time}", { time: hm(ts) });
  if (ts >= d0 - 6 * DAY) return `${fmtDate(ts, { weekday: "short" })} ${hm(ts)}`;
  return `${fmtDate(ts, { day: "numeric", month: "short", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })} ${hm(ts)}`;
}
/** "Today 14:40", "Yesterday 21:30", "18 Nov 16:20". */
export const whenLong = (ts: number) => (ts >= dayStart(Date.now()) ? t("Today {time}", { time: hm(ts) }) : whenShort(ts));

export const isRestore = (v: Version) => v.label.startsWith("Restored") || v.label === "Before restore" || v.label === "Before keeping the other version" || v.label === "Before resolving a conflict";
export const isOther = (v: Version) => v.label.startsWith("Other version");
export const isAi = (v: Version) => /^AI/.test(v.label);
export const isNamed = (v: Version) => !!v.label && !isRestore(v) && !isOther(v) && !isAi(v);
export const restoreText = (l: string) => (l.startsWith("Restored from ") ? t("Restored from {when}", { when: l.slice(14) }) : t(l));

export type Kind = "cur" | "auto" | "named" | "sync" | "ai" | "restore";
/** One row of the history list: a version, or a session of quiet autosaves represented by its newest version. */
export interface HRow { v: Version | null; kind: Kind; n: number; from: number; to: number; no: number; add: number; del: number; mine: boolean }

/** `live` is newest first. Version numbers count from the oldest (v1). Autosaves from one device within 30 min form a session. */
export function historyRows(live: Version[], device: string): HRow[] {
  const total = live.length;
  const rows: HRow[] = [];
  for (let i = 0; i < live.length; i++) {
    const v = live[i];
    const mine = !v.device || v.device === device;
    const kind: Kind = isRestore(v) ? "restore" : isAi(v) ? "ai" : isNamed(v) ? "named" : isOther(v) || !mine ? "sync" : "auto";
    const prev = live[i + 1];
    const d = charDelta(prev?.body ?? "", v.body);
    if (kind === "auto") {
      let j = i;
      while (j + 1 < live.length) {
        const nx = live[j + 1];
        if (isRestore(nx) || isAi(nx) || isNamed(nx) || isOther(nx) || (nx.device || device) !== (v.device || device) || live[j].createdAt - nx.createdAt > 30 * 60_000) break;
        j++;
      }
      const last = live[j + 1];
      const dd = charDelta(last?.body ?? "", v.body);
      rows.push({ v, kind, n: j - i + 1, from: live[j].createdAt, to: v.createdAt, no: total - i, add: dd.add, del: dd.del, mine });
      i = j;
      continue;
    }
    rows.push({ v, kind, n: 1, from: v.createdAt, to: v.createdAt, no: total - i, add: d.add, del: d.del, mine });
  }
  return rows;
}

/** Restore as new version (Versions tab, Activity "Restore to here", the studio): logged as "reverted", undoable from the toast. */
export async function restoreFromVersion(note: Note, v: Version, latestBody: string | undefined) {
  const before = { title: note.title, body: note.body };
  const when = whenShort(v.createdAt);
  void latestBody;
  await autoVersion("restore", note);
  activityHint(note.id, { action: "reverted", ver: v.id, from: String(v.createdAt) });
  await updateNote(note.id, { title: v.title, body: v.body });
  await snapshot({ ...note, title: v.title, body: v.body }, `Restored from ${fmtDate(v.createdAt, { day: "numeric", month: "short" })}`);
  toast(t("Restored from {when}", { when }), { label: t("Undo"), run: () => { activityHint(note.id, { action: "reverted", to: "undo" }); void updateNote(note.id, before); } });
}
