/* Desktop note list pieces (design R6 · NOTE LIST, "Lumen 30 Sidebars Tags Spaces" R6-30D/J/K/L):
 * filter box (typed `tag:#x status:y` and words become removable chips), Sort / Group menus with the Select / Done
 * toggle, rows (amber inset edge on the open note, max 3 tag chips then +N with a hover list), date groups with
 * Pinned on top, the "filter matches nothing" state, and the multi-select bulk bar (Tag, Move, Delete + Undo). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Globe, Link2, Star } from "lucide-react";
import type { Note, Space } from "../../shared/types";
import { moveNote, restoreNote, trashNote } from "../lib/actions";
import { fmtDate, fmtNum, t } from "../lib/i18n";
import { smartTokens } from "../lib/smart";
import { toast, useVault } from "../lib/store";
import { addTagToNotes } from "../lib/tag-ops";
import { readTagMeta, TAG_PROP, TAG_SPACE, tagColor } from "../lib/tag-tree";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { TagChip, TagInput } from "./TagPicker";
import { cx, STATUS_COLOR } from "./ui";

// ------------------------------------------------------------------ filter chips
/** Chip colour: `tag:` → the tag's colour, `status:` → the status colour, other operators → link teal, words → muted. */
export function chipColor(tok: string, colors: Record<string, string>): string {
  const m = /^-?(\w+):"?#?([^"]*)"?$/.exec(tok);
  if (tok.startsWith("#")) return tagColor(tok.slice(1).toLowerCase(), colors) ?? "var(--learn)";
  if (!m) return "var(--muted)";
  if (m[1] === "tag") return tagColor(m[2].toLowerCase(), colors) ?? "var(--learn)";
  if (m[1] === "status") return STATUS_COLOR[m[2] as keyof typeof STATUS_COLOR] ?? "var(--info)";
  return "var(--link)";
}
/** A finished operator token (`tag:#x`, `status:y`, `"phrase"`, `#x`) that should turn into a chip when followed by a space. */
const isOp = (tok: string) => /^-?\w+:("[^"]*"|\S+)$/.test(tok) || /^"[^"]+"$/.test(tok) || /^-?#\S+$/.test(tok);

export interface FilterChip { text: string; onRemove: () => void }
export function FilterBox({ chips, draft, setDraft, addChips, popChip, onSaveSmart }: {
  chips: FilterChip[]; draft: string; setDraft: (s: string) => void; addChips: (toks: string[]) => void; popChip: () => void; onSaveSmart?: () => void;
}) {
  const v = useVault();
  const colors = useTagColors(v);
  const ref = useRef<HTMLInputElement>(null);
  const active = chips.length > 0;
  const commit = (s: string, all: boolean) => {
    const toks = smartTokens(s);
    if (!toks.length) return setDraft("");
    // operators become chips as soon as they're complete; plain words wait for Enter
    const last = s.endsWith(" ") || all ? null : toks.pop()!;
    const done = all ? toks : toks.filter(isOp);
    const keep = all ? [] : toks.filter((x) => !isOp(x));
    if (done.length) addChips(done);
    setDraft([...keep, ...(last !== null ? [last] : [])].join(" ") + (keep.length && last === null ? " " : ""));
  };
  return (
    <div className={cx("group/filter flex min-h-10 cursor-text flex-wrap content-start items-center gap-1 rounded-[7px] border bg-bg px-2 py-[3px]", active ? "border-accent" : "border-line focus-within:border-accent")} onClick={() => ref.current?.focus()} dir="ltr" data-list-filter>
      <Glyph name="filter" size={13} color="var(--muted)" />
      {chips.map((c, i) => {
        const col = chipColor(c.text, colors);
        return (
          <span key={i + c.text} className="flex h-[22px] items-center gap-1 rounded-[5px] pe-1 ps-[7px] font-mono text-[12px]" style={{ background: `color-mix(in srgb, ${col} 14%, transparent)`, color: col }}>
            {c.text}<button type="button" aria-label={t("Remove filter {f}", { f: c.text })} onClick={(e) => { e.stopPropagation(); c.onRemove(); }} className="font-sans opacity-70 hover:opacity-100">×</button>
          </span>
        );
      })}
      <input ref={ref} value={draft} spellCheck={false} aria-label={t("Filter notes")} placeholder={active ? "" : t("Filter… tag:#llm status:learning")}
        onChange={(e) => { const s = e.target.value; if (/\s$/.test(s) && isOp(smartTokens(s).pop() ?? "")) commit(s, false); else setDraft(s); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(draft, true); }
          else if (e.key === "Backspace" && !draft && chips.length) { e.preventDefault(); popChip(); }
          else if (e.key === "Escape") { if (draft) setDraft(""); else (e.target as HTMLInputElement).blur(); }
        }}
        className="h-[22px] min-w-[40px] flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-muted" />
      {onSaveSmart && (active || draft.trim()) && (
        <button type="button" title={t("Save search as smart folder")} aria-label={t("Save search as smart folder")} onClick={(e) => { e.stopPropagation(); onSaveSmart(); }}
          className="hidden size-[22px] shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-surface-2 hover:text-ink focus-visible:flex group-focus-within/filter:flex group-hover/filter:flex"><Glyph name="smart-folder" size={14} /></button>
      )}
    </div>
  );
}

/** Stored tag colours (Inbox props), memoised on the raw JSON. */
function useTagColors(v: ReturnType<typeof useVault>) {
  const raw = v.spaceMap.get(TAG_SPACE)?.props?.[TAG_PROP];
  return useMemo(() => readTagMeta(raw).colors, [raw]);
}
export { useTagColors };

// ------------------------------------------------------------------ small dropdown
export function Dropdown<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", f); addEventListener("keydown", k);
    return () => { removeEventListener("mousedown", f); removeEventListener("keydown", k); };
  }, [open]);
  const cur = options.find((o) => o.value === value);
  return (
    <span ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-ink">
        {label} <b className="font-medium text-ink">{cur?.label}</b><Glyph name="chevron-down" size={11} />
      </button>
      {open && (
        <div role="menu" className="absolute start-0 top-[calc(100%+4px)] z-30 flex w-[160px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)]">
          {options.map((o) => (
            <button key={o.value} role="menuitemradio" aria-checked={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }} className="flex h-7 items-center gap-2 rounded-[6px] px-2 text-start text-ink hover:bg-bg">
              <span className="w-3.5">{o.value === value && <Glyph name="check" size={13} color="var(--accent)" />}</span>{o.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ groups
export type Group = "date" | "status" | "none";
const DAY = 86400000;
/** Group key for a timestamp: Today, Yesterday, This week, This month, Earlier. */
export function dateBucket(ts: number, now = Date.now()): string {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const t0 = d0.getTime();
  if (ts >= t0) return "Today";
  if (ts >= t0 - DAY) return "Yesterday";
  if (ts >= t0 - 6 * DAY) return "This week";
  if (ts >= t0 - 30 * DAY) return "This month";
  return "Earlier";
}
/** Rows with group headers: pinned notes first under "Pinned", then the chosen grouping (in list order). */
export function groupRows(notes: Note[], group: Group, timeOf: (n: Note) => number, total = notes.length): ({ h: string; pin?: boolean } | Note)[] {
  const pinned = notes.filter((n) => n.pinned), rest = notes.filter((n) => !n.pinned);
  const out: ({ h: string; pin?: boolean } | Note)[] = [];
  if (pinned.length && (rest.length || group !== "none")) out.push({ h: "Pinned", pin: true });
  out.push(...pinned);
  if (group === "none") { if (pinned.length && rest.length) out.push({ h: "Notes" }); out.push(...rest); return out; }
  const order: string[] = [], by = new Map<string, Note[]>();
  // Long lists (Lumen 22 "Lists that stay fast"): month headers ("November · 86") instead of Today / This week / Earlier.
  const months = group === "date" && total > MONTHS_ABOVE;
  for (const n of rest) {
    const k = months ? monthKey(timeOf(n)) : group === "date" ? dateBucket(timeOf(n)) : n.status ?? "none";
    if (!by.has(k)) { by.set(k, []); order.push(k); }
    by.get(k)!.push(n);
  }
  if (group === "status") order.sort((a, b) => ["learning", "review", "todo", "mastered", "none"].indexOf(a) - ["learning", "review", "todo", "mastered", "none"].indexOf(b));
  for (const k of order) { out.push({ h: group === "status" ? (k === "none" ? "No status" : k) : months ? `${k}:${by.get(k)!.length}` : k }); out.push(...by.get(k)!); }
  return out;
}
export function GroupHeader({ h, pin }: { h: string; pin?: boolean }) {
  const m = /^m:(\d{4}-\d{2}):(\d+)$/.exec(h);
  if (m) return <div className="sticky top-0 z-[1] flex shrink-0 items-center gap-1.5 bg-bg px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted" data-group-head data-month={m[1]}>{monthName(m[1])} · {fmtNum(Number(m[2]))}</div>;
  return <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{pin && <Glyph name="pin" size={11} />}{t(h)}</div>;
}
/** Above this many notes, Group: Date uses month headers (and the list gets the date scrubber). */
export const MONTHS_ABOVE = 300;
export const monthKey = (ts: number) => { const d = new Date(ts); return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
/** "November" this year, "June 2025" other years. */
export function monthName(ym: string, short = false) {
  const [y, mo] = ym.split("-").map(Number);
  const d = new Date(y, mo - 1, 1);
  return fmtDate(d, y === new Date().getFullYear() ? { month: short ? "short" : "long" } : { month: short ? "short" : "long", year: "numeric" });
}

// ------------------------------------------------------------------ row
export function DeskRow({ n, active, selecting, selected, space, preview, time, colors, onClick, onDragStart }: {
  n: Note; active: boolean; selecting: boolean; selected: boolean; space?: Space; preview: string; time: string; colors: Record<string, string>;
  onClick: (e: React.MouseEvent) => void; onDragStart: (e: React.DragEvent) => void;
}) {
  const on = selecting && selected;
  const shown = n.tags.slice(0, 3), more = n.tags.length - shown.length;
  return (
    <div role="button" tabIndex={0} draggable={!selecting} onDragStart={onDragStart} onClick={onClick} aria-selected={selecting ? selected : active} data-note-row={n.id}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e as unknown as React.MouseEvent); } }}
      className={cx("flex w-full shrink-0 cursor-pointer gap-2.5 border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] px-3 py-[9px] text-start outline-none focus-visible:bg-surface", !on && !(active && !selecting) && "hover:bg-surface")}
      style={{ background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : active && !selecting ? "var(--surface)" : undefined, boxShadow: active && !selecting ? "inset 2px 0 0 var(--accent)" : undefined }}>
      {selecting && (
        <span className="mt-0.5 box-border flex size-4 shrink-0 items-center justify-center rounded-[4px]" style={{ background: on ? "var(--accent)" : "transparent", border: on ? "none" : "1.5px solid var(--muted)" }}>
          {on && <Glyph name="check" size={11} color="var(--accent-fg)" stroke={3} />}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-center gap-[7px]">
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
          <span dir="auto" title={n.title} className="min-w-0 flex-1 truncate font-semibold">{n.title || t("Untitled")}</span>
          {n.shareId ? <Link2 size={12} className="shrink-0 text-info" /> : null}
          {n.published ? <Globe size={12} className="shrink-0 text-ok" /> : null}
          {n.favorite ? <Star size={12} className="shrink-0 text-warn" /> : null}
          <span className="shrink-0 text-[11px] text-muted">{time}</span>
        </div>
        <span dir="auto" className="line-clamp-2 text-[12px] leading-[17px] text-muted">{preview}</span>
        {(shown.length > 0 || space) && (
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">{shown.map((tag) => <TagChip key={tag} tag={tag} color={tagColor(tag, colors)} />)}</div>
            {more > 0 && (
              <span className="group/more relative shrink-0 text-[11px] text-muted" tabIndex={0} aria-label={n.tags.map((x) => "#" + x).join(" ")}>+{more}
                <span className="pointer-events-none absolute start-0 top-[calc(100%+4px)] z-30 hidden w-max max-w-[240px] flex-wrap gap-1 rounded-[8px] border border-line bg-surface-2 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.35)] group-hover/more:flex group-focus/more:flex">
                  {n.tags.map((tag) => <TagChip key={tag} tag={tag} color={tagColor(tag, colors)} />)}
                </span>
              </span>
            )}
            {space && <span dir="auto" className="ms-auto flex min-w-0 shrink items-center gap-1 truncate text-[11px] text-muted"><SpaceIcon space={space} size={12} />{space.name}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ empty (filter matches nothing)
export function FilterEmpty({ filter, where, onClear, onAllSpaces }: { filter: string; where: string; onClear: () => void; onAllSpaces?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center" data-filter-empty>
      <Glyph name="filter" size={20} color="var(--muted)" tile="#9AA0AA" />
      <span className="mt-1 text-[14px] font-semibold">{t("No notes here")}</span>
      <span className="leading-[18px] text-muted">{tFill(t("Nothing matches {filter} in {where} yet."), { filter: <span dir="ltr" className="font-mono text-ink">{filter}</span>, where })}</span>
      <div className="mt-1.5 flex gap-2">
        <button onClick={onClear} className="flex h-[30px] items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg hover:brightness-110">{t("Clear filter")}</button>
        {onAllSpaces && <button onClick={onAllSpaces} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 hover:bg-surface-2">{t("Search all spaces")}</button>}
      </div>
    </div>
  );
}
function tFill(s: string, vars: Record<string, ReactNode>): ReactNode[] {
  return s.split(/(\{\w+\})/g).map((p, i) => { const m = /^\{(\w+)\}$/.exec(p); return m && m[1] in vars ? <span key={i}>{vars[m[1]]}</span> : p; });
}

// ------------------------------------------------------------------ bulk bar
export function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const v = useVault();
  const [pop, setPop] = useState<null | "tag" | "move">(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pop) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPop(null); };
    addEventListener("mousedown", f);
    return () => removeEventListener("mousedown", f);
  }, [pop]);
  const n = ids.length;
  const tag = async (tg: string) => {
    setPop(null);
    const r = await addTagToNotes(ids, tg);
    toast(t("Tagged {n} notes #{tag}", { n: r.count, tag: tg }), { label: t("Undo"), run: () => void r.undo() });
  };
  const move = async (spaceId: string, folderId: string | null, name: string) => {
    setPop(null);
    const before = ids.map((id) => v.byId.get(id)).filter((x): x is Note => !!x).map((x) => [x.id, x.spaceId, x.folderId] as const);
    for (const id of ids) await moveNote(id, spaceId, folderId);
    toast(t("Moved {n} notes to {name}", { n, name }), { label: t("Undo"), run: () => { for (const [id, s, f] of before) void moveNote(id, s, f); } }, { icon: "check" });
    onDone();
  };
  const del = async () => {
    const list = [...ids];
    for (const id of list) await trashNote(id);
    toast(t("Moved {n} notes to Trash", { n: list.length }), { label: t("Undo"), run: () => { for (const id of list) void restoreNote(id); } });
    onDone();
  };
  const btn = "flex h-7 items-center gap-[5px] rounded-[6px] border border-line px-2 hover:bg-surface-2 disabled:opacity-50";
  return (
    <div ref={ref} className="relative flex h-11 shrink-0 items-center gap-1.5 border-t border-line bg-surface px-2.5" data-bulk-bar>
      <b className="flex-1 font-semibold">{t("{n} selected", { n })}</b>
      <button className={btn} disabled={!n} aria-expanded={pop === "tag"} onClick={() => setPop(pop === "tag" ? null : "tag")}><Glyph name="tag" size={13} />{t("Tag")}</button>
      <button className={btn} disabled={!n} aria-expanded={pop === "move"} onClick={() => setPop(pop === "move" ? null : "move")}><Glyph name="folder" size={13} />{t("Move")}</button>
      <button className="flex h-7 items-center rounded-[6px] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] px-2 text-bad hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] disabled:opacity-50" disabled={!n} aria-label={t("Delete selected notes")} title={t("Delete")} onClick={() => void del()}><Glyph name="trash" size={13} /></button>
      {pop === "tag" && (
        <div className="absolute bottom-[calc(100%+6px)] end-2.5 z-30 flex w-[300px] flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-3 shadow-[0_16px_40px_rgba(0,0,0,.4)]">
          <span className="text-[12px] text-muted">{t("Add a tag to {n} notes", { n })}</span>
          <TagInput onPick={(x) => void tag(x)} onCancel={() => setPop(null)} placeholder={t("Tag name")} dropUp />
        </div>
      )}
      {pop === "move" && (
        <div className="absolute bottom-[calc(100%+6px)] end-2.5 z-30 flex max-h-[360px] w-[260px] flex-col overflow-y-auto rounded-[12px] border border-line bg-surface-2 p-1 shadow-[0_16px_40px_rgba(0,0,0,.4)]" role="menu">
          <span className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Move {n} notes to", { n })}</span>
          {v.spaces.map((s) => (
            <div key={s.id} className="flex flex-col">
              <button role="menuitem" onClick={() => void move(s.id, null, s.name)} className="flex h-8 items-center gap-2 rounded-[7px] px-2 text-start hover:bg-bg"><SpaceIcon space={s} size={14} /><span dir="auto" className="truncate">{s.name}</span></button>
              {folderTree(v.folders.filter((f) => f.spaceId === s.id)).map(([f, depth]) => (
                <button key={f.id} role="menuitem" onClick={() => void move(s.id, f.id, f.name)} className="flex h-7 items-center gap-2 rounded-[7px] pe-2 text-start text-[12.5px] hover:bg-bg" style={{ paddingInlineStart: 14 + depth * 14 }}>
                  <Glyph name="folder" size={13} color="var(--muted)" /><span dir="auto" className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
type F = ReturnType<typeof useVault>["folders"][number];
function folderTree(list: F[]): [F, number][] {
  const out: [F, number][] = [];
  const walk = (parent: string | null, d: number) => { for (const f of list.filter((x) => (x.parentId ?? null) === parent).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))) { out.push([f, d]); if (d < 6) walk(f.id, d + 1); } };
  walk(null, 0);
  return out;
}
