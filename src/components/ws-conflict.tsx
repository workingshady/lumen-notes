import { useLiveQuery } from "dexie-react-hooks";
import { GitMerge } from "lucide-react";
import { lazy, Suspense, useSyncExternalStore } from "react";
import type { Note, Version } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { db, now, save, uid } from "../lib/db";
import { setUI, toast } from "../lib/store";
// Preview (markdown-it, KaTeX, highlight.js) loads only when a conflict is opened: this sheet is mounted at start-up.
const Preview = lazy(() => import("./Preview").then((m) => ({ default: m.Preview })));
import { Button, Sheet } from "./ui";
import { fmtDate, fmtTime, t, tx } from "../lib/i18n";

/*
 * Sync conflicts (design: 06b · 22F "Kept newer version · View other").
 * Every local note write is tagged with this device (lumenDevice / lumenDeviceName) and the version it was based on (lumenBase).
 * When sync brings in a newer note from another device that was NOT based on our latest edit, last-write-wins keeps the newer
 * one, and our losing copy is saved to the note's history (a synced Version) so nothing is lost. A toast offers "View other".
 */
const DEVICE_KEY = "lumen.deviceId";
const NAME_KEY = "lumen.deviceName";
export const DEVICE: string = (() => { try { let d = localStorage.getItem(DEVICE_KEY); if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); } return d; } catch { return "unknown"; } })();
export function deviceName(): string {
  try { const n = localStorage.getItem(NAME_KEY); if (n) return n; } catch { /* ignore */ }
  const ua = navigator.userAgent;
  const android = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(ua)?.[1];
  if (android && !/^K$/.test(android)) return android.trim();
  if (/Android/.test(ua)) return "Android phone";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "another device";
}

type Tagged = Note & { dirty?: 0 | 1; lumenDevice?: string; lumenDeviceName?: string; lumenBase?: number };

db.use({
  stack: "dbcore",
  name: "lumenConflicts",
  create(down) {
    return {
      ...down,
      table(name) {
        const t = down.table(name);
        if (name !== "notes") return t;
        return {
          ...t,
          async mutate(req) {
            if (req.type !== "put") return t.mutate(req);
            const values = await Promise.all((req.values as Tagged[]).map(async (v) => {
              if (!v || typeof v !== "object" || !v.id) return v;
              const old = (await t.get({ trans: req.trans, key: v.id })) as Tagged | undefined;
              if (v.dirty === 1) {
                // Local edit: tag device + the version this edit started from.
                const base = old ? (old.dirty === 1 && old.lumenDevice === DEVICE ? old.lumenBase ?? 0 : old.updatedAt) : 0;
                return { ...v, lumenDevice: DEVICE, lumenDeviceName: deviceName(), lumenBase: base };
              }
              if (old && old.lumenDevice === DEVICE && v.lumenDevice && v.lumenDevice !== DEVICE && old.body !== v.body && v.updatedAt !== old.updatedAt && (v.lumenBase ?? 0) < old.updatedAt && !v.deleted && !old.deleted) {
                queueMicrotask(() => setTimeout(() => void conflict(old, v), 0));
              }
              return v;
            }));
            return t.mutate({ ...req, values } as typeof req);
          },
        };
      },
    };
  },
});

async function conflict(mine: Tagged, theirs: Tagged) {
  const keepTheirs = theirs.updatedAt >= mine.updatedAt;
  const loser = keepTheirs ? mine : theirs;
  const v: Version = { id: uid(), noteId: mine.id, title: loser.title, body: loser.body, label: `Other version · ${keepTheirs ? deviceName() : theirs.lumenDeviceName ?? "another device"}`, createdAt: now(), updatedAt: now(), deleted: 0 } as Version;
  await save("version", v);
  if (!keepTheirs) await updateNote(mine.id, { body: mine.body });
  const winner = keepTheirs ? theirs : mine;
  const at = fmtTime(winner.updatedAt);
  toast(t("Kept newer version"), { label: t("View other"), run: () => openOther(v.id) }, { icon: "merge", sub: t("From {device} at {time} · the other is in history", { device: winner.lumenDeviceName ?? t("another device"), time: at }), ms: 10000, actionStyle: "link" });
}

// ------------------------------------------------------------------ "View other" sheet
let otherId: string | null = null;
const subs = new Set<() => void>();
export function openOther(versionId: string | null) { otherId = versionId; subs.forEach((f) => f()); }
const useOther = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => otherId);

export function ConflictSheet() {
  const id = useOther();
  const v = useLiveQuery(() => (id ? db.versions.get(id) : undefined), [id]);
  const note = useLiveQuery(() => (v ? db.notes.get(v.noteId) : undefined), [v?.noteId]);
  return (
    <Sheet open={!!id && !!v} onClose={() => openOther(null)} wide title={<span className="flex items-center gap-2"><GitMerge size={16} className="text-warn" />{t("Other version")}{v ? <span dir="auto"> · {v.title}</span> : ""}</span>}>
      {v && (
        <div className="flex flex-col gap-3">
          <div className="text-[12.5px] text-muted">{tx("{label} · saved to history {date}. The note itself kept the newer version.", { label: <span dir="auto">{v.label}</span>, date: fmtDate(v.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) })}</div>
          <div className="max-h-[56vh] overflow-y-auto rounded-[10px] border border-line bg-bg px-5 py-4"><Suspense fallback={null}><Preview note={{ id: v.noteId, body: v.body, spaceId: note?.spaceId ?? "inbox" }} className="reading" /></Suspense></div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(v.body); toast(t("Copied")); }}>{t("Copy text")}</Button>
            <Button onClick={() => { openOther(null); if (note) setUI({ view: "notes", noteId: note.id, panel: "versions" }); }}>{t("Open history")}</Button>
            <Button variant="primary" onClick={async () => { if (!note) return; await save("version", { id: uid(), noteId: note.id, title: note.title, body: note.body, label: "Before keeping the other version", createdAt: now() }); await updateNote(note.id, { body: v.body }); openOther(null); toast(t("Kept the other version"), { label: t("Undo"), run: () => void updateNote(note.id, { body: note.body }) }); }}>{t("Use this version")}</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
