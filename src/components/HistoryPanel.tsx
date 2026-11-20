/* Note history panel (design R6 · HISTORY, "Lumen 30 Sidebars Tags Spaces" R6-30Q/R): tabs Versions | Recently opened.
 * Versions are grouped by day (Today / Earlier); each row shows the device and +/− characters against the version
 * before it; named versions (bookmark) carry a label you can set or change (double-click, F2 or the pin button).
 * "Restore as new version" never overwrites: the current text is saved as a version, then the old text becomes the
 * note and a new "Restored from …" version on top. Diff opens the full comparison over the note.
 * Activity (lib/activity.ts): what happened to the note, grouped by day; entries tied to a version can be previewed and
 * restored with the same restore as the Versions tab. "All notes" lists recent activity across the vault. */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Note, Version } from "../../shared/types";
import { snapshot, updateNote } from "../lib/actions";
import { ACTIVITY_CAP, activityHint, charDelta } from "../lib/activity";
import { db, save } from "../lib/db";
import { fmtDate, fmtNum, t } from "../lib/i18n";
import { useRecentOpened } from "../lib/recent-opened";
import { openNote, toast, useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { DiffOverlay } from "./RightPanel";
import { cx } from "./ui";

export { charDelta };

const DAY = 86400000;
const dayStart = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hm = (ts: number) => fmtDate(ts, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "Yesterday 23:05", "Mon 20:18" (this week), "8 Nov 20:18". */
function whenShort(ts: number) {
  const d0 = dayStart(Date.now());
  if (ts >= d0) return hm(ts);
  if (ts >= d0 - DAY) return t("Yesterday {time}", { time: hm(ts) });
  if (ts >= d0 - 6 * DAY) return `${fmtDate(ts, { weekday: "short" })} ${hm(ts)}`;
  return `${fmtDate(ts, { day: "numeric", month: "short", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })} ${hm(ts)}`;
}
const isRestore = (v: Version) => v.label.startsWith("Restored") || v.label === "Before restore" || v.label === "Before keeping the other version";
const isNamed = (v: Version) => !!v.label && !isRestore(v) && !v.label.startsWith("Other version");
const restoreText = (l: string) => (l.startsWith("Restored from ") ? t("Restored from {when}", { when: l.slice(14) }) : t(l));
function rowTitle(v: Version) {
  const today = v.createdAt >= dayStart(Date.now());
  if (isRestore(v)) return today && v.label === "Before restore" ? `${hm(v.createdAt)} · ${t("Before restore")}` : restoreText(v.label);
  if (v.label) return `${today ? hm(v.createdAt) : whenShort(v.createdAt)} · “${v.label === "Manual save" ? t("Manual save") : v.label}”`;
  return today ? `${hm(v.createdAt)} · ${t("auto-save")}` : whenShort(v.createdAt);
}
const fmtD = (d: { add: number; del: number }) => [d.add ? `+${fmtNum(d.add)}` : "", d.del ? `−${fmtNum(d.del)}` : ""].filter(Boolean).join(" ");

export function HistoryPanel({ note }: { note: Note }) {
  const [tab, setTab] = useState<"versions" | "activity" | "opened">("versions");
  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]" data-history>
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
        {([["versions", "history", t("Versions")], ["activity", "list", t("Activity")], ["opened", "clock", t("Recently opened")]] as const).map(([k, g, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("flex h-[30px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[7px] px-2", tab === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>
            <Glyph name={g} size={14} />{l}
          </button>
        ))}
      </div>
      {tab === "versions" ? <Versions note={note} /> : tab === "activity" ? <ActivityTab note={note} /> : <Opened />}
    </div>
  );
}

function Versions({ note }: { note: Note }) {
  const all = useLiveQuery(() => db.versions.where("noteId").equals(note.id).reverse().sortBy("createdAt"), [note.id]);
  const live = useMemo(() => (all ?? []).filter((v) => !v.deleted), [all]);
  const deltas = useMemo(() => live.map((v, i) => charDelta(live[i + 1]?.body ?? "", v.body)), [live]);
  const current = useMemo(() => charDelta(live[0]?.body ?? "", note.body), [live, note.body]);
  const [selId, setSelId] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const [naming, setNaming] = useState<string | null>(null); // version id, or "current" = save a named version now
  const sel = live.find((v) => v.id === selId) ?? (selId === null ? live[0] ?? null : null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor, [contenteditable=true]") || !ref.current?.isConnected) return;
      const i = sel ? live.findIndex((v) => v.id === sel.id) : -1;
      if (e.key === "ArrowDown" && i < live.length - 1) { e.preventDefault(); setSelId(live[i + 1].id); }
      else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); setSelId(live[i - 1].id); }
      else if (e.key === "Escape" && diff) setDiff(false);
      else if (e.key === "F2" && sel) { e.preventDefault(); setNaming(sel.id); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [sel, live, diff]);

  const restore = async () => {
    if (!sel) return;
    await restoreFromVersion(note, sel, live[0]?.body);
    setSelId(null); setDiff(false);
  };
  const setLabel = async (id: string, label: string) => {
    setNaming(null);
    if (id === "current") { await snapshot(note, label.trim() || "Manual save"); toast(t("Version saved")); return; }
    const v = live.find((x) => x.id === id);
    if (v && v.label !== label.trim()) await save("version", { ...v, label: label.trim() });
  };

  const today = dayStart(Date.now());
  const head = (h: string) => <div className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{h}</div>;
  let shownEarlier = false;
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
        {head(t("Today"))}
        <Row glyph="s-learning" title={t("Current")} sub={t("This device")} d={current} on={false} onClick={() => { setSelId(null); setDiff(false); }}
          naming={naming === "current"} nameInit="" onName={() => setNaming("current")} onNamed={(l) => void setLabel("current", l)} onCancelName={() => setNaming(null)} nameTitle={t("Save a named version now")} />
        {live.map((v, i) => {
          const earlier = v.createdAt < today && !shownEarlier;
          if (earlier) shownEarlier = true;
          return (
            <div key={v.id} className="flex flex-col">
              {earlier && head(t("Earlier"))}
              <Row glyph={isNamed(v) ? "pin" : "history"} title={rowTitle(v)} sub={v.device || fmtD(deltas[i]) || " "} d={deltas[i]} on={sel?.id === v.id}
                onClick={() => setSelId(v.id)} onDoubleClick={() => setNaming(v.id)}
                naming={naming === v.id} nameInit={isNamed(v) && v.label !== "Manual save" ? v.label : ""} onName={() => setNaming(v.id)} onNamed={(l) => void setLabel(v.id, l)} onCancelName={() => setNaming(null)} nameTitle={t("Name this version")} />
            </div>
          );
        })}
        {!live.length && <p className="px-3.5 pt-2 text-muted">{t("Versions are saved automatically while you write (every 2 min at most), and whenever you click Save. Restoring never overwrites: it adds a new version on top.")}</p>}
      </div>
      <div className="mt-auto flex shrink-0 gap-2 border-t border-line px-3.5 py-3">
        <button disabled={!sel} onClick={() => void restore()} className="flex h-8 flex-1 items-center justify-center rounded-[8px] bg-accent font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50">{t("Restore as new version")}</button>
        <button disabled={!sel} aria-pressed={diff} onClick={() => setDiff(!diff)} className={cx("flex h-8 items-center rounded-[8px] border border-line px-2.5 hover:bg-surface-2 disabled:opacity-50", diff && "bg-surface-2")}>{t("Diff")}</button>
      </div>
      {diff && sel && <DiffOverlay anchor={ref} note={note} v={sel} onClose={() => setDiff(false)} onRestore={() => void restore()} />}
    </div>
  );
}

/** Restore as new version (Versions tab and Activity "Restore to here"): logged as "reverted", undoable from the toast. */
async function restoreFromVersion(note: Note, v: Version, latestBody: string | undefined) {
  const before = { title: note.title, body: note.body };
  const when = whenShort(v.createdAt);
  if (latestBody !== note.body) await snapshot(note, "");
  activityHint(note.id, { action: "reverted", ver: v.id, from: String(v.createdAt) });
  await updateNote(note.id, { title: v.title, body: v.body });
  await snapshot({ ...note, title: v.title, body: v.body }, `Restored from ${fmtDate(v.createdAt, { day: "numeric", month: "short" })}`);
  toast(t("Restored from {when}", { when }), { label: t("Undo"), run: () => { activityHint(note.id, { action: "reverted", to: "undo" }); void updateNote(note.id, before); } });
}

function Row({ glyph, title, sub, d, on, onClick, onDoubleClick, naming, nameInit, onName, onNamed, onCancelName, nameTitle }: {
  glyph: string; title: string; sub: string; d: { add: number; del: number }; on: boolean; onClick: () => void; onDoubleClick?: () => void;
  naming: boolean; nameInit: string; onName: () => void; onNamed: (l: string) => void; onCancelName: () => void; nameTitle: string;
}) {
  return (
    <div role="button" tabIndex={0} aria-selected={on} onClick={onClick} onDoubleClick={onDoubleClick} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className={cx("group/v flex shrink-0 cursor-pointer items-center gap-2.5 px-3.5 py-2 outline-none", on ? "bg-surface-2 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-2/60")}>
      <Glyph name={glyph} size={14} color={on ? "var(--accent)" : "var(--muted)"} />
      <div className="flex min-w-0 flex-1 flex-col">
        {naming ? (
          <input autoFocus defaultValue={nameInit} placeholder={t("Version name")} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") onNamed((e.target as HTMLInputElement).value); if (e.key === "Escape") onCancelName(); }} onBlur={(e) => onNamed(e.target.value)}
            className="h-6 rounded-[5px] border border-accent bg-bg px-1.5 text-ink outline-none" />
        ) : <span dir="auto" className="truncate font-medium">{title}</span>}
        <span dir="auto" className="truncate text-[11.5px] text-muted">{sub}</span>
      </div>
      {!naming && <button type="button" title={nameTitle} aria-label={nameTitle} onClick={(e) => { e.stopPropagation(); onName(); }} className="hidden size-6 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-bg hover:text-ink group-hover/v:flex"><Glyph name="pin" size={13} /></button>}
      <span className="font-mono text-[11px] font-medium text-ok">{d.add ? `+${fmtNum(d.add)}` : ""}</span>
      <span className="font-mono text-[11px] font-medium text-bad">{d.del ? `−${fmtNum(d.del)}` : ""}</span>
    </div>
  );
}

function Opened() {
  const list = useRecentOpened();
  const v = useVault();
  const today = dayStart(Date.now());
  const rows = list.map((x) => ({ ...x, n: v.byId.get(x.id) })).filter((x) => x.n && !x.n.deleted);
  const head = (h: string) => <div className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{h}</div>;
  let earlier = false;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
      {rows.length > 0 && rows[0].at >= today && head(t("Today"))}
      {rows.map((r) => {
        const h = r.at < today && !earlier;
        if (h) earlier = true;
        const sp = v.spaceMap.get(r.n!.spaceId);
        return (
          <div key={r.id} className="flex flex-col">
            {h && head(t("Earlier"))}
            <button onClick={() => openNote(r.id)} className="flex items-center gap-2.5 px-3.5 py-2 text-start hover:bg-surface-2">
              <Glyph name={r.n!.type} size={14} color="var(--muted)" />
              <span className="flex min-w-0 flex-1 flex-col"><span dir="auto" className="truncate font-medium">{r.n!.title || t("Untitled")}</span><span dir="auto" className="truncate text-[11.5px] text-muted">{sp?.name ?? t("Inbox")}</span></span>
              <span className="shrink-0 text-[11px] text-muted">{whenShort(r.at)}</span>
            </button>
          </div>
        );
      })}
      {!rows.length && <p className="px-3.5 pt-2 text-muted">{t("Notes you open on this device show up here.")}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Activity tab
const EDITS = new Set<Activity["action"]>(["created", "imported", "duplicated", "edited", "reverted"]);
const ACT_GLYPH: Record<Activity["action"], string> = {
  created: "plus", imported: "insert", duplicated: "copy", edited: "text", renamed: "h1", moved: "folder", tagged: "tag", type: "switch",
  status: "status-pill", trashed: "trash", restored: "inbox", shared: "link", unshared: "broken-link", published: "globe", unpublished: "globe", reverted: "history",
};
/** "now", "12m", "3h" today; "Yesterday 23:05" / "Mon 20:18" / "8 Nov 20:18" before. */
function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return t("now");
  if (ts >= dayStart(Date.now())) return m < 60 ? t("{n}m", { n: m }) : t("{n}h", { n: Math.floor(m / 60) });
  return whenShort(ts);
}
function dayHead(ts: number) {
  const d0 = dayStart(Date.now());
  if (ts >= d0) return t("Today");
  if (ts >= d0 - DAY) return t("Yesterday");
  return fmtDate(ts, { weekday: "long", day: "numeric", month: "short", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

function ActivityTab({ note }: { note: Note }) {
  const [scope, setScope] = useState<"note" | "all">("note");
  const [filter, setFilter] = useState<"all" | "edits" | "structure">("all");
  const [limit, setLimit] = useState(80);
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<Version | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVault();
  const rows = useLiveQuery(
    () => (scope === "note"
      ? db.activity.where("noteId").equals(note.id).filter((r) => !r.deleted).toArray()
      : db.activity.orderBy("at").reverse().filter((r) => !r.deleted).limit(400).toArray()),
    [scope, note.id],
  );
  const versions = useLiveQuery(() => db.versions.where("noteId").equals(note.id).filter((x) => !x.deleted).toArray(), [note.id]);
  const vmap = useMemo(() => new Map((versions ?? []).map((x) => [x.id, x])), [versions]);
  const latest = useMemo(() => (versions ?? []).reduce<Version | undefined>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), undefined), [versions]);
  const list = useMemo(() => (rows ?? [])
    .filter((r) => filter === "all" || (filter === "edits") === EDITS.has(r.action))
    .sort((a, b) => (b.end ?? b.at) - (a.end ?? a.at)), [rows, filter]);
  const shown = list.slice(0, limit);

  const placeName = (p?: string) => {
    const [sp, f] = (p ?? "").split("/");
    const s = v.spaceMap.get(sp)?.name ?? (sp === "inbox" ? t("Inbox") : t("a deleted space"));
    const fo = f ? v.folderMap.get(f)?.name : "";
    return fo ? `${s} › ${fo}` : s;
  };
  const describe = (a: Activity): { main: string; detail?: React.ReactNode } => {
    const q = (x?: string) => `“${x ?? ""}”`;
    switch (a.action) {
      case "created": return { main: t("Created") };
      case "imported": return { main: t("Imported") };
      case "duplicated": return { main: t("Duplicated from {title}", { title: q(a.from) }) };
      case "edited": {
        const u = a.unit === "cards" ? t("cards") : a.unit === "elements" ? t("elements") : "";
        return { main: a.unit === "chars" ? t("Edited") : t("Edited the board"), detail: <Delta add={a.add} del={a.del} unit={u} img={a.img} /> };
      }
      case "reverted": return a.to === "undo" ? { main: t("Undid a restore") } : { main: t("Restored the version from {when}", { when: whenShort(Number(a.from)) }), detail: <Delta add={a.add} del={a.del} /> };
      case "renamed": return { main: t("Renamed to {title}", { title: q(a.to) }), detail: <span className="text-muted">{t("was {title}", { title: q(a.from) })}</span> };
      case "moved": return { main: t("Moved to {place}", { place: placeName(a.to) }), detail: <span className="text-muted">{t("from {place}", { place: placeName(a.from) })}</span> };
      case "type": return { main: t("Type changed to {type}", { type: t(a.to ?? "") }) };
      case "status": return { main: a.to ? t("Status changed to {status}", { status: t(a.to) }) : t("Status cleared") };
      case "tagged": return {
        main: t("Tags changed"),
        detail: <span className="inline-flex flex-wrap gap-x-1.5">{(a.plus ?? []).map((x) => <span key={"+" + x} className="text-ok">+#{x}</span>)}{(a.minus ?? []).map((x) => <span key={"-" + x} className="text-bad line-through">#{x}</span>)}</span>,
      };
      case "trashed": return { main: t("Moved to Trash") };
      case "restored": return { main: t("Restored from Trash") };
      case "shared": return { main: t("Shared a link") };
      case "unshared": return { main: t("Stopped sharing") };
      case "published": return { main: t("Published to the blog") };
      case "unpublished": return { main: t("Removed from the blog") };
    }
  };
  const restoreTo = async (ver: Version) => { setPreview(null); setSel(null); await restoreFromVersion(note, ver, latest?.body); };

  const chip = (on: boolean) => cx("h-[26px] shrink-0 whitespace-nowrap rounded-[6px] px-[7px] text-[12px]", on ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink");
  let lastHead = "";
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col" data-activity>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
        <button className={chip(scope === "note")} aria-pressed={scope === "note"} onClick={() => { setScope("note"); setLimit(80); }}>{t("This note")}</button>
        <button className={chip(scope === "all")} aria-pressed={scope === "all"} onClick={() => { setScope("all"); setLimit(80); }}>{t("All notes")}</button>
        <span className="mx-0.5 h-4 w-px bg-line" />
        {([["all", t("All")], ["edits", t("Edits")], ["structure", t("Structure")]] as const).map(([k, l]) => (
          <button key={k} className={chip(filter === k)} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
        {shown.map((a) => {
          const ts = a.end ?? a.at;
          const h = dayHead(ts);
          const head = h !== lastHead;
          lastHead = h;
          const { main, detail } = describe(a);
          const other = scope === "all" && a.noteId !== note.id;
          const ver = !other && a.ver ? vmap.get(a.ver) : undefined;
          const title = v.byId.get(a.noteId)?.title ?? a.title;
          const on = sel === a.id;
          const act = () => (other ? openNote(a.noteId) : setSel(on ? null : a.id));
          return (
            <div key={a.id} className="flex flex-col">
              {head && <div className="shrink-0 px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{h}</div>}
              <div role="button" tabIndex={0} aria-selected={on} data-action={a.action} onClick={act} onKeyDown={(e) => { if (e.key === "Enter") act(); }}
                className={cx("group/a flex shrink-0 cursor-pointer gap-2.5 px-3.5 py-2 outline-none", on ? "bg-surface-2 shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-2/60")}>
                <span className="mt-[2px] shrink-0"><Glyph name={a.action === "edited" && a.unit !== "chars" ? (a.unit === "cards" ? "canvas" : "whiteboard") : ACT_GLYPH[a.action]} size={14} color={on ? "var(--accent)" : "var(--muted)"} /></span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span dir="auto" className="truncate font-medium" title={main}>{main}</span>
                  {scope === "all" && <span dir="auto" className="truncate text-[11.5px] text-ink/80">{title || t("Untitled")}</span>}
                  {detail && <span dir="auto" className="min-w-0 truncate text-[11.5px]">{detail}</span>}
                  <span className="truncate text-[11.5px] text-muted" title={fmtDate(ts, { dateStyle: "medium", timeStyle: "short" })}>
                    {[ago(ts), a.device].filter(Boolean).join(" · ")}
                  </span>
                  {on && ver && (
                    <span className="mt-1 flex gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); setPreview(ver); }} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 text-[12px] hover:bg-bg">{t("Preview")}</button>
                      <button onClick={(e) => { e.stopPropagation(); void restoreTo(ver); }} className="flex h-7 items-center rounded-[7px] bg-accent px-2.5 text-[12px] font-semibold text-accent-fg hover:brightness-110">{t("Restore to here")}</button>
                    </span>
                  )}
                  {on && !ver && <span className="text-[11.5px] text-muted">{t("No saved version for this entry.")}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {list.length > shown.length && (
          <button onClick={() => setLimit((n) => n + 100)} className="mx-3.5 mt-2 flex h-8 shrink-0 items-center justify-center rounded-[8px] border border-line text-muted hover:bg-surface-2 hover:text-ink">
            {t("Show {n} more", { n: fmtNum(Math.min(100, list.length - shown.length)) })}
          </button>
        )}
        {rows && !list.length && (
          <p className="px-3.5 pt-3 text-muted">{rows.length ? t("Nothing matches this filter yet.")
            : scope === "note" ? t("Nothing recorded yet. Edits, renames, moves, tags, sharing and restores show up here, on every device.") : t("No activity yet.")}</p>
        )}
        {scope === "note" && list.length >= ACTIVITY_CAP && <p className="px-3.5 pt-2 text-[11.5px] text-muted">{t("Only the last {n} entries are kept for each note.", { n: ACTIVITY_CAP })}</p>}
      </div>
      {preview && <DiffOverlay anchor={ref} note={note} v={preview} onClose={() => setPreview(null)} onRestore={() => void restoreTo(preview)} />}
    </div>
  );
}

function Delta({ add, del, unit, img }: { add?: number; del?: number; unit?: string; img?: number }) {
  if (!add && !del && !img) return null;
  return (
    <span className="font-mono text-[11px] font-medium">
      {add ? <span className="text-ok">+{fmtNum(add)} </span> : null}
      {del ? <span className="text-bad">−{fmtNum(del)} </span> : null}
      {unit ? <span className="font-sans text-muted">{unit}</span> : null}
      {img ? <span className="font-sans text-muted"> · {t("+{n} images", { n: fmtNum(img) })}</span> : null}
    </span>
  );
}
