/* Smart folders (design 20b · D7 + Lumen 21 "smart folder row" / "filter row"): sidebar section with drag reorder,
 * editor sheet, smart-folder list header + rows, phone rows. Logic + storage format: lib/smart.ts (docs/SMART_FOLDERS.md). */
import { ChevronDown, ChevronUp, Pencil, Pin, PinOff, Table2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { propsOf, type Ctx } from "../lib/base";
import { PRESETS } from "../lib/canvas";
import { db, patch } from "../lib/db";
import type { GlyphName } from "../lib/glyphs";
import {
  GLYPHS, glyphName, moveSmart, newSmartId, OPERATOR_CHIPS, orderSmart, readSmart, removeSmart, reorderSmart, searchText, serializeSmart, SMART_PROP, SMART_SPACE, smartMatcher, smartTokens, suggestName, toBaseNote, upsertSmart,
  type SmartCtx, type SmartFolder,
} from "../lib/smart";
import { go, noteDerived, openNote, toast, useUI, useVault, type UI, type Vault } from "../lib/store";
import { fmtDate, fmtNum, t } from "../lib/i18n";
import { Glyph } from "./Glyph";
import { cx } from "./ui";

/** Stored colour (preset key "1".."6", a CSS colour or a token) → CSS colour. */
export const smartColor = (c?: string | null) => (c ? PRESETS[c] ?? c : null);
/** The folder's glyph (LumenGlyph), in its colour unless `color` overrides it. */
export const glyphOf = (sf: Pick<SmartFolder, "glyph" | "color">, size = 16, color?: string) =>
  <Glyph name={glyphName(sf.glyph) as GlyphName} size={size} color={color ?? smartColor(sf.color) ?? "currentColor"} />;

// ------------------------------------------------------------------ data
export function useSmartFolders(): SmartFolder[] {
  const v = useVault();
  const raw = v.spaceMap.get(SMART_SPACE)?.props?.[SMART_PROP];
  return useMemo(() => orderSmart(readSmart(raw)), [raw]);
}
/** Read-modify-write on the fresh Inbox record (the list syncs with the space). */
async function updateSmart(fn: (list: SmartFolder[]) => SmartFolder[]) {
  const sp = await db.spaces.get(SMART_SPACE);
  if (!sp) return toast(t("The Inbox space is missing: can't save smart folders"), undefined, { icon: "error" });
  const next = fn(readSmart(sp.props?.[SMART_PROP]));
  await patch("space", SMART_SPACE, { props: { ...(sp.props ?? {}), [SMART_PROP]: serializeSmart(next) } });
}
export function smartCtx(v: Vault): SmartCtx {
  const base: Ctx = {
    spaceName: (id) => v.spaceMap.get(id)?.name ?? (id === "inbox" ? "Inbox" : id),
    folderPath: (id) => {
      const names: string[] = []; const seen = new Set<string>();
      for (let f = id ? v.folderMap.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); names.unshift(f.name); }
      return names.join("/");
    },
  };
  return {
    folderMap: v.folderMap, spaceMap: v.spaceMap, outlinks: v.outlinks, backlinks: v.backlinks, base,
    props: (n) => noteDerived("smartProps", n, propsOf), text: (n) => noteDerived("smartText", n, searchText),
  };
}
export const smartIdOf = (ui: Pick<UI, "filter">) => (ui.filter?.startsWith("smart:") ? ui.filter.slice(6) : null);
/** Notes of the active smart folder (null when the list isn't showing one). */
export function smartListFor(v: Vault, ui: Pick<UI, "filter">, list: SmartFolder[]): { sf: SmartFolder | null; notes: Note[] } | null {
  const id = smartIdOf(ui);
  if (!id) return null;
  const sf = list.find((x) => x.id === id) ?? null;
  return { sf, notes: sf ? v.notes.filter(smartMatcher(sf, smartCtx(v))) : [] };
}
/** Filter a list by a typed query (note-list search box). */
export const filterByQuery = (v: Vault, notes: Note[], query: string) => (query.trim() ? notes.filter(smartMatcher({ query }, smartCtx(v))) : notes);
export const openSmart = (sf: SmartFolder) => go("notes", { spaceId: "all", folderId: null, tag: null, filter: `smart:${sf.id}`, noteId: null });
function useCounts(list: SmartFolder[]) {
  const v = useVault();
  const ctx = useMemo(() => smartCtx(v), [v]);
  return useMemo(() => new Map(list.map((sf) => [sf.id, v.notes.filter(smartMatcher(sf, ctx)).length])), [list, v, ctx]);
}

/** The current list scope as query operators, so "Save as smart folder" keeps what the user was looking at. */
export function scopeQuery(v: Vault, ui: Pick<UI, "spaceId" | "folderId" | "tag" | "filter">): string {
  const q = (s: string) => (/\s/.test(s) ? `"${s.toLowerCase()}"` : s.toLowerCase());
  const parts: string[] = [];
  if (ui.spaceId !== "all") { const s = v.spaceMap.get(ui.spaceId); if (s) parts.push(`space:${q(s.name)}`); }
  if (ui.folderId) { const f = v.folderMap.get(ui.folderId); if (f) parts.push(`in:${q(f.name)}`); }
  if (ui.tag) parts.push(`tag:#${ui.tag}`);
  if (ui.filter === "paths") parts.push("type:path");
  if (ui.filter === "published") parts.push("is:published");
  return parts.join(" ");
}

/** "Save as base": a base note (database view) with the same filters; opens it. */
export async function saveSmartAsBase(sf: Pick<SmartFolder, "name" | "query" | "filters" | "match">) {
  const { body, dropped } = toBaseNote(sf);
  const n = await createNote({ type: "base", title: sf.name, body, spaceId: SMART_SPACE });
  openNote(n.id, "read");
  toast(t("Created base “{name}”", { name: sf.name }), undefined, { icon: "check", sub: dropped.length ? t("Not carried over: {list}", { list: dropped.join(", ") }) : undefined });
}

// ------------------------------------------------------------------ editor (one host, opened from anywhere)
type Draft = Partial<SmartFolder>;
let draft: Draft | null = null;
const subs = new Set<() => void>();
export function openSmartEditor(d: Draft) { draft = { ...d }; subs.forEach((f) => f()); }
const closeEditor = () => { draft = null; subs.forEach((f) => f()); };
const useDraft = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => draft);

/** Mount once (Palette mounts it): the "New / Edit smart folder" sheet. */
export function SmartEditorHost() {
  const d = useDraft();
  return d ? <SmartEditor key={d.id ?? "new"} init={d} /> : null;
}

const COLORS = Object.keys(PRESETS);
const RING = "0 0 0 2px var(--surface), 0 0 0 3.5px var(--text)";
/** Design toggle (20b "Pin to top"): 30×18 track, 12 px knob. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="relative h-[18px] w-[30px] shrink-0 rounded-[9px] transition-colors" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-[3px] size-3 rounded-full transition-all" style={on ? { insetInlineEnd: 3, background: "var(--accent-fg)" } : { insetInlineStart: 3, background: "var(--muted)" }} />
    </button>
  );
}

function SmartEditor({ init }: { init: Draft }) {
  const v = useVault();
  const ui = useUI();
  const existing = !!init.id;
  const [name, setName] = useState(init.name ?? "");
  const [query, setQuery] = useState(init.query ?? "");
  const [filters, setFilters] = useState<string[]>(init.filters ?? []);
  const [match, setMatch] = useState<"and" | "or">(init.match ?? "and");
  const [glyph, setGlyph] = useState<string>(glyphName(init.glyph));
  const [color, setColor] = useState<string | null>(init.color ?? null);
  const [pinned, setPinned] = useState(!!init.pinned);
  const [picker, setPicker] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const ctx = useMemo(() => smartCtx(v), [v]);
  const rows = filters.filter((f) => f.trim());
  const sample = useMemo(() => v.notes.filter(smartMatcher({ query, filters: rows, match }, ctx)), [v, query, rows.join("\n"), match, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = !query.trim() && !rows.length;
  const value = (): SmartFolder => ({ id: init.id ?? newSmartId(), name: name.trim() || suggestName(query), query: query.trim(), filters: rows.length ? rows : undefined, match, glyph, color, pinned, sort: init.sort ?? 0 });
  async function save() {
    const sf = value();
    await updateSmart((l) => upsertSmart(l, existing ? sf : { ...sf, sort: undefined }));
    closeEditor();
    if (!existing) toast(t("Saved smart folder “{name}”", { name: sf.name }), { label: t("Open"), run: () => openSmart(sf) }, { icon: "check" });
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeEditor(); if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !empty) void save(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const asBase = async () => { const sf = value(); closeEditor(); await saveSmartAsBase(sf); };
  const del = async () => {
    const id = init.id!;
    const old = readSmart((await db.spaces.get(SMART_SPACE))?.props?.[SMART_PROP]).find((x) => x.id === id);
    await updateSmart((l) => removeSmart(l, id));
    closeEditor();
    if (ui.filter === `smart:${id}`) go("notes", { filter: null });
    if (old) toast(t("Deleted smart folder “{name}”", { name: old.name }), { label: t("Undo"), run: () => void updateSmart((l) => upsertSmart(l, old)) });
  };
  /** Operator chip: append it; a placeholder value (`#x`, `folder`, `"exact words"`) is selected so typing replaces it. */
  const addOp = (op: string) => {
    const sp = ui.spaceId !== "all" ? v.spaceMap.get(ui.spaceId)?.name ?? "Inbox" : "Inbox";
    const ins = op === "space:" ? `space:${sp ? (/\s/.test(sp) ? `"${sp.toLowerCase()}"` : sp.toLowerCase()) : ""}` : op;
    const base = query.trimEnd();
    const next = (base ? base + " " : "") + ins;
    setQuery(next);
    requestAnimationFrame(() => {
      const el = qRef.current;
      if (!el) return;
      el.focus();
      const ph = ins === "tag:#x" ? 1 : ins === "in:folder" ? 6 : ins === '"exact words"' ? 13 : 0;
      el.setSelectionRange(next.length - ph, next.length);
    });
  };
  const c = smartColor(color);
  const n = sample.length;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.45)] md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && closeEditor()} data-smart-editor>
      <div role="dialog" aria-label={existing ? t("Edit smart folder") : t("New smart folder")} className="sheet-in safe-b flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-[14px] border border-b-0 border-line bg-surface text-[13px] md:w-[560px] md:rounded-[14px] md:border-b">
        <div className="flex justify-center pt-2.5 md:hidden"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="px-5 pb-1.5 pt-[18px] text-[17px] font-[650]">{existing ? t("Edit smart folder") : t("New smart folder")}</div>
        <div className="flex flex-col gap-3.5 px-5 py-2.5">
          <div className="relative flex gap-2.5">
            <button type="button" aria-label={t("Glyph")} title={t("Glyph")} onClick={() => setPicker((p) => !p)} className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2">
              <Glyph name={glyph as GlyphName} size={18} color={c ?? "var(--accent)"} />
            </button>
            {picker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPicker(false)} />
                <div className="absolute start-0 top-11 z-20 grid grid-cols-8 gap-0.5 rounded-[10px] border border-line bg-surface-2 p-1.5 shadow-xl">
                  {GLYPHS.map((g) => (
                    <button key={g} type="button" aria-label={t("Glyph {name}", { name: g })} aria-pressed={glyph === g} onClick={() => { setGlyph(g); setPicker(false); }}
                      className={cx("flex size-9 items-center justify-center rounded-[7px]", glyph === g ? "bg-bg" : "hover:bg-bg")}>
                      <Glyph name={g} size={16} color={glyph === g ? c ?? "var(--accent)" : "var(--muted)"} />
                    </button>
                  ))}
                </div>
              </>
            )}
            <input autoFocus={!existing && !!query} dir="auto" aria-label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestName(query)}
              className="h-10 min-w-0 flex-1 rounded-[7px] border border-line bg-bg px-3 text-ink outline-none placeholder:text-muted focus:border-accent" />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted">{t("Search")}</span>
            <input ref={qRef} dir="ltr" autoFocus={existing || !query} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="type:lesson due:this-week -status:done" spellCheck={false}
              className="min-h-10 rounded-[7px] border border-line bg-bg px-3 font-mono text-[13px] text-ink caret-[var(--accent)] outline-none placeholder:text-muted focus:border-accent" />
            <span className={cx("flex items-center gap-1 text-[12px]", !empty && n ? "text-ok" : "text-muted")} title={sample.slice(0, 8).map((x) => x.title).join("\n")}>
              {empty ? t("Type a search or pick an operator below") : n ? <><Glyph name="check" size={12} />{t("{n} note matches right now|{n} notes match right now", { n })}</> : t("No notes match right now")}
            </span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {OPERATOR_CHIPS.map((o) => (
              <button key={o} type="button" onClick={() => addOp(o)} title={t("Add {op}", { op: o })} dir="ltr" className="rounded-[5px] bg-surface-2 px-[7px] font-mono text-[12px] leading-[22px] text-muted hover:text-ink">{o === "space:" ? `space:${(ui.spaceId !== "all" && v.spaceMap.get(ui.spaceId)?.name) || "Inbox"}` : o}</button>
            ))}
          </div>
          {/* Filter rows (Bases expressions, round 3): folded under the operators */}
          {filters.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2"><span className="flex-1 text-[12px] text-muted">{t("Filter rows (Bases syntax)")}</span>
                {rows.length > 1 && <div className="flex rounded-[6px] border border-line p-px text-[11.5px]">{(["and", "or"] as const).map((m) => <button key={m} type="button" onClick={() => setMatch(m)} className={cx("h-6 rounded-[5px] px-2", match === m ? "bg-surface-2 font-semibold" : "text-muted")}>{m === "and" ? t("All") : t("Any")}</button>)}</div>}
              </div>
              {filters.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={f} onChange={(e) => setFilters((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder="due < today()" spellCheck={false} dir="ltr" className="h-8 min-w-0 flex-1 rounded-[7px] border border-line bg-bg px-2.5 font-mono text-[12.5px] outline-none focus:border-accent" />
                  <button type="button" aria-label={t("Remove filter row")} onClick={() => setFilters((xs) => xs.filter((_, j) => j !== i))} className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setFilters((xs) => [...xs, ""])} className="self-start text-[12px] text-muted hover:text-ink">{t("+ Filter row")}</button>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="flex-1">{t("Colour")}</span>
            {COLORS.map((k) => (
              <button key={k} type="button" aria-label={t("Colour {n}", { n: k })} aria-pressed={color === k} onClick={() => setColor(color === k ? null : k)} className="size-5 rounded-full"
                style={{ background: PRESETS[k], boxShadow: color === k ? RING : "none" }} />
            ))}
          </div>
          <div className="flex items-center gap-2.5"><span className="flex-1">{t("Pin to top")}</span><Toggle on={pinned} onChange={setPinned} label={t("Pin to top")} /></div>
          {!filters.length && <button type="button" onClick={() => setFilters([""])} className="-mt-1 self-start text-[12px] text-muted hover:text-ink">{t("+ Filter row (Bases syntax)")}</button>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3.5">
          <button type="button" disabled={empty} onClick={() => void asBase()} title={t("Create a base note (database view) with the same filters")} className="flex-1 text-start text-muted hover:text-ink disabled:opacity-50">{t("Save as base…")}</button>
          {existing ? <button type="button" onClick={() => void del()} className="px-2 text-bad hover:underline">{t("Delete")}</button>
            : <button type="button" onClick={closeEditor} className="px-2 text-muted hover:text-ink">{t("Cancel")}</button>}
          <button type="button" disabled={empty} onClick={() => void save()} className="flex h-[34px] items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50">{t("Save")}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar section (row = Lumen 21 "smart folder row")
/** `bare` (round-6 sidebar): no section header; the sidebar draws its own foldable one. */
export function SidebarSmartFolders({ bare = false }: { bare?: boolean } = {}) {
  const v = useVault();
  const ui = useUI();
  const list = useSmartFolders();
  const [menu, setMenu] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  /** Drag reorder: `to` = drop position in the list without the dragged folder. */
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const counts = useCounts(list);
  const active = ui.view === "notes" ? smartIdOf(ui) : null;
  const from = drag ? list.findIndex((x) => x.id === drag.id) : -1;
  const onOver = (e: React.DragEvent, i: number) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    if (from < to) to--;
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const drop = () => { if (!drag) return; const { id, to } = drag; setDrag(null); if (from !== to) void updateSmart((l) => reorderSmart(l, id, to)); };
  /** Insertion line under display row `i` (or above row 0 when i = -1). */
  const lineAt = (i: number) => !!drag && drag.to !== from && (drag.to > from ? drag.to : drag.to - 1) === i;
  return (
    <div className={bare ? "" : "px-2"} data-smart-folders onDragEnd={() => setDrag(null)}>
      <div className={cx("flex items-center px-2 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted", bare && "hidden")}>
        <span className="flex-1">{t("Smart folders")}</span>
        <button title={t("New smart folder")} aria-label={t("New smart folder")} className="text-[14px] font-normal leading-none hover:text-ink" onClick={() => openSmartEditor({ query: scopeQuery(v, ui) })}>+</button>
      </div>
      {!list.length && <div className="px-2 py-1 text-[12px] text-muted">{t("Save a search to keep it here.")}</div>}
      {lineAt(-1) && <div className="mx-2 h-0.5 rounded-[1px] bg-accent" />}
      {list.map((sf, i) => {
        const on = active === sf.id;
        const dragging = drag?.id === sf.id;
        return (
          <div key={sf.id}>
            <div draggable={rename !== sf.id} data-smart-row={sf.id}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-lumen-smart", sf.id); setDrag({ id: sf.id, to: i }); }}
              onDragOver={(e) => onOver(e, i)} onDrop={(e) => { e.preventDefault(); drop(); }}
              className={cx("group relative flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-[13px]", on ? "bg-surface-2" : "hover:bg-surface-2", dragging && "opacity-60")}
              style={dragging ? { boxShadow: "0 8px 20px rgba(0,0,0,.4)", transform: "translateX(8px) rotate(-1deg)" } : undefined}
              onContextMenu={(e) => { e.preventDefault(); setMenu(sf.id); }}>
              {glyphOf(sf, 16, smartColor(sf.color) ?? "var(--muted)")}
              {rename === sf.id ? (
                <input autoFocus defaultValue={sf.name} dir="auto" className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1 outline-none"
                  onBlur={(e) => { setRename(null); const n = e.target.value.trim(); if (n && n !== sf.name) void updateSmart((l) => upsertSmart(l, { ...sf, name: n })); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(null); }} />
              ) : (
                <button dir="auto" className="min-w-0 flex-1 truncate whitespace-nowrap text-start" title={sf.query} onClick={() => openSmart(sf)} onDoubleClick={() => setRename(sf.id)}>{sf.name}</button>
              )}
              {sf.pinned && !on && <span className="text-[11px] text-muted group-hover:hidden">{t("pinned")}</span>}
              <span className="text-[11.5px] tabular-nums text-muted group-hover:hidden">{fmtNum(counts.get(sf.id) ?? 0)}</span>
              <button className="hidden text-muted hover:text-ink group-hover:block" onClick={() => setMenu(sf.id)} aria-label={t("Smart folder menu")}>⋯</button>
              {menu === sf.id && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
                  <div className="absolute start-6 top-full z-40 w-52 rounded-[10px] border border-line bg-surface p-1 shadow-xl fade-in" onClick={() => setMenu(null)}>
                    {([
                      [<Pencil size={13} key="e" />, t("Edit…"), () => openSmartEditor(sf)],
                      [<Pencil size={13} key="r" />, t("Rename"), () => setRename(sf.id)],
                      [sf.pinned ? <PinOff size={13} key="p" /> : <Pin size={13} key="p" />, sf.pinned ? t("Unpin") : t("Pin to top"), () => void updateSmart((l) => upsertSmart(l, { ...sf, pinned: !sf.pinned }))],
                      [<ChevronUp size={13} key="u" />, t("Move up"), () => void updateSmart((l) => moveSmart(l, sf.id, -1))],
                      [<ChevronDown size={13} key="d" />, t("Move down"), () => void updateSmart((l) => moveSmart(l, sf.id, 1))],
                      [<Table2 size={13} key="b" />, t("Save as base"), () => void saveSmartAsBase(sf)],
                    ] as [ReactNode, string, () => void][]).map(([ic, l, fn]) => <button key={l} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-[13px] hover:bg-surface-2" onClick={fn}><span className="text-muted">{ic}</span>{l}</button>)}
                    <div className="flex gap-1.5 px-2 py-1.5">
                      <button title={t("No colour")} aria-label={t("No colour")} className="size-5 rounded-full border border-line" onClick={() => void updateSmart((l) => upsertSmart(l, { ...sf, color: null }))} />
                      {COLORS.map((k) => <button key={k} aria-label={t("Colour {n}", { n: k })} className="size-5 rounded-full" style={{ background: PRESETS[k], boxShadow: sf.color === k ? RING : "none" }} onClick={() => void updateSmart((l) => upsertSmart(l, { ...sf, color: k }))} />)}
                    </div>
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-[13px] text-bad hover:bg-surface-2" onClick={async () => {
                      await updateSmart((l) => removeSmart(l, sf.id));
                      if (active === sf.id) go("notes", { filter: null });
                      toast(t("Deleted smart folder “{name}”", { name: sf.name }), { label: t("Undo"), run: () => void updateSmart((l) => upsertSmart(l, sf)) });
                    }}><Trash2 size={13} />{t("Delete")}</button>
                  </div>
                </>
              )}
            </div>
            {lineAt(i) && <div className="mx-2 h-0.5 rounded-[1px] bg-accent" />}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ note list: query box (any list) + smart folder header
const CHIP = "shrink-0 rounded-[4px] bg-[color-mix(in_srgb,var(--link)_14%,transparent)] px-[5px] text-link";
/** Desktop note-list search box: filters the list with the search operators; the folder button saves it as a smart folder. */
export function NoteListQueryBar({ query, setQuery, count }: { query: string; setQuery: (q: string) => void; count: number }) {
  const v = useVault();
  const ui = useUI();
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5" data-list-query>
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-line bg-bg px-2 text-muted focus-within:border-accent">
        <Glyph name="query" size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder={t("Filter… tag:#llm status:learning")} spellCheck={false} dir="ltr"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-muted" />
        {query && <span className="shrink-0 text-[11px] tabular-nums">{fmtNum(count)}</span>}
        {query && <button aria-label={t("Clear search")} onClick={() => setQuery("")} className="shrink-0 hover:text-ink"><X size={12} /></button>}
      </label>
      {query.trim() && (
        <button title={t("Save search as smart folder")} aria-label={t("Save search as smart folder")} onClick={() => openSmartEditor({ query: [scopeQuery(v, ui), query.trim()].filter(Boolean).join(" ") })}
          className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="smart-folder" size={16} /></button>
      )}
    </div>
  );
}

/** Smart folder list header (20b): glyph + name + Edit, then the query as chips; typing after the chips narrows the list. */
export function SmartListHeader({ sf, query, setQuery, count }: { sf: SmartFolder; query: string; setQuery: (q: string) => void; count: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-b border-line p-3.5 text-[13px] leading-[1.25]" data-smart-header>
      <div className="flex items-center gap-2">
        {glyphOf(sf, 18, smartColor(sf.color) ?? "var(--accent)")}
        <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-[650]" title={t("{n} note|{n} notes", { n: count })}>{sf.name}</span>
        {query.trim() && <button className="text-muted hover:text-ink" title={t("Save the narrowed search as a new smart folder")} onClick={() => openSmartEditor({ query: `${sf.query} ${query.trim()}`.trim(), filters: sf.filters, match: sf.match })}>{t("Save as new")}</button>}
        <button className="text-muted hover:text-ink" onClick={() => openSmartEditor(sf)}>{t("Edit")}</button>
      </div>
      <div className="flex h-8 cursor-text items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-[7px] [scrollbar-width:none] border border-line bg-bg px-2 font-mono text-[12px] focus-within:border-accent" dir="ltr" onClick={() => input.current?.focus()} title={sf.query}>
        {smartTokens(sf.query).map((tok, i) => <span key={i} className={CHIP}>{tok}</span>)}
        {sf.filters?.map((f, i) => <span key={"f" + i} className={CHIP}>{f}</span>)}
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} aria-label={t("Narrow “{name}”", { name: sf.name })} spellCheck={false}
          className="min-w-[40px] flex-1 bg-transparent text-ink outline-none" />
      </div>
    </div>
  );
}

/** "due Mon" (within a week), "due 3 Dec", "due today", "overdue". */
function dueLabel(raw: string | undefined): { text: string; overdue: boolean } | null {
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim()) : null;
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: t("overdue"), overdue: true };
  if (days === 0) return { text: t("due today"), overdue: false };
  if (days < 7) return { text: t("due {date}", { date: fmtDate(d, { weekday: "short" }) }), overdue: false };
  return { text: t("due {date}", { date: fmtDate(d, { day: "numeric", month: "short" }) }), overdue: false };
}
/** One note in a smart folder list (20b): type glyph + title, then "course · due Mon". */
export function SmartRow({ n, active, onOpen }: { n: Note; active: boolean; onOpen: () => void }) {
  const v = useVault();
  const p = noteDerived("smartProps", n, propsOf);
  const where = p.course || p.source || (n.folderId ? v.folderMap.get(n.folderId)?.name : "") || v.spaceMap.get(n.spaceId)?.name || "";
  const due = dueLabel(p.due ?? p.deadline);
  const sub = [where, due?.text ?? fmtDate(n.updatedAt, { day: "numeric", month: "short" })].filter(Boolean).join(" · ");
  const gc = active ? "var(--info)" : n.status === "review" || due?.overdue ? "var(--warning)" : "var(--muted)";
  return (
    <button onClick={onOpen} className={cx("flex w-full shrink-0 flex-col gap-[3px] border-b border-line px-3.5 py-2.5 text-start text-[13px]", active ? "bg-surface" : "hover:bg-surface")}>
      <span className="flex w-full items-center gap-2 font-semibold leading-5"><Glyph name={n.type as GlyphName} size={14} color={gc} /><span dir="auto" className="min-w-0 flex-1 truncate">{n.title || t("Untitled")}</span></span>
      <span dir="auto" className="truncate text-[12px] leading-[15px] text-muted">{sub}</span>
    </button>
  );
}

// ------------------------------------------------------------------ phone: rows in the folders sheet
export function PhoneSmartRows({ onPick }: { onPick: () => void }) {
  const v = useVault();
  const ui = useUI();
  const list = useSmartFolders();
  const counts = useCounts(list);
  const active = smartIdOf(ui);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edit = (sf: SmartFolder) => { onPick(); openSmartEditor(sf); };
  return (
    <div className="flex flex-col gap-0.5 px-1 pt-1" data-phone-smart>
      <div className="flex items-center px-2 py-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        <span className="flex-1">{t("Smart folders")}</span>
        <button aria-label={t("New smart folder")} onClick={() => { onPick(); openSmartEditor({ query: scopeQuery(v, ui) }); }} className="-my-2 flex size-9 items-center justify-center text-[17px] font-normal">+</button>
      </div>
      {!list.length && <div className="px-2 pb-2 text-[13px] text-muted">{t("Save a search from the search screen to keep it here.")}</div>}
      {list.map((sf) => {
        const on = active === sf.id;
        return (
          <button key={sf.id} title={t("Long-press to edit")} onClick={() => { openSmart(sf); onPick(); }} onContextMenu={(e) => { e.preventDefault(); edit(sf); }}
            onTouchStart={() => { press.current = setTimeout(() => edit(sf), 550); }} onTouchEnd={() => clearTimeout(press.current)} onTouchMove={() => clearTimeout(press.current)}
            className={cx("flex h-12 w-full items-center gap-3 rounded-[10px] px-2 text-start text-[13px]", on && "bg-surface-2")}>
            {glyphOf(sf, 18, smartColor(sf.color) ?? "var(--muted)")}
            <span dir="auto" className={cx("flex-1 truncate", on && "font-semibold")}>{sf.name}</span>
            <span className="text-muted tabular-nums">{fmtNum(counts.get(sf.id) ?? 0)}</span>
          </button>
        );
      })}
    </div>
  );
}
