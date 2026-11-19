/* Note history panel (design R6 · HISTORY, "Lumen 30 Sidebars Tags Spaces" R6-30Q/R): tabs Versions | Recently opened.
 * Versions are grouped by day (Today / Earlier); each row shows the device and +/− characters against the version
 * before it; named versions (bookmark) carry a label you can set or change (double-click, F2 or the pin button).
 * "Restore as new version" never overwrites: the current text is saved as a version, then the old text becomes the
 * note and a new "Restored from …" version on top. Diff opens the full comparison over the note. */
import { useLiveQuery } from "dexie-react-hooks";
import { diffChars } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, Version } from "../../shared/types";
import { snapshot, updateNote } from "../lib/actions";
import { db, save } from "../lib/db";
import { fmtDate, fmtNum, t } from "../lib/i18n";
import { useRecentOpened } from "../lib/recent-opened";
import { openNote, toast, useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { DiffOverlay } from "./RightPanel";
import { cx } from "./ui";

/** +added / −removed characters from `a` to `b` (common prefix/suffix trimmed; very long middles fall back to an estimate). */
export function charDelta(a: string, b: string): { add: number; del: number } {
  if (a === b) return { add: 0, del: 0 };
  let s = 0;
  const n = Math.min(a.length, b.length);
  while (s < n && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const x = a.slice(s, a.length - e), y = b.slice(s, b.length - e);
  if (x.length + y.length > 40000) return { add: Math.max(0, y.length - x.length) || y.length, del: Math.max(0, x.length - y.length) || x.length };
  let add = 0, del = 0;
  for (const p of diffChars(x, y)) { if (p.added) add += p.value.length; else if (p.removed) del += p.value.length; }
  return { add, del };
}

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
  const [tab, setTab] = useState<"versions" | "opened">("versions");
  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]" data-history>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2" role="tablist">
        {([["versions", "history", t("Versions")], ["opened", "clock", t("Recently opened")]] as const).map(([k, g, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5", tab === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>
            <Glyph name={g} size={14} />{l}
          </button>
        ))}
      </div>
      {tab === "versions" ? <Versions note={note} /> : <Opened />}
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
    const before = { title: note.title, body: note.body };
    const when = whenShort(sel.createdAt);
    if (live[0]?.body !== note.body) await snapshot(note, "");
    await updateNote(note.id, { title: sel.title, body: sel.body });
    await snapshot({ ...note, title: sel.title, body: sel.body }, `Restored from ${fmtDate(sel.createdAt, { day: "numeric", month: "short" })}`);
    setSelId(null); setDiff(false);
    toast(t("Restored from {when}", { when }), { label: t("Undo"), run: () => void updateNote(note.id, before) });
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
