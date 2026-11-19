/* Smart folders (design update 04 §D7): sidebar section, editor sheet, note-list query bar, phone rows.
 * Logic + storage format live in lib/smart.ts (docs/SMART_FOLDERS.md). UI kept thin for the coming redesign. */
import { BookOpen, BookmarkPlus, Check, ChevronDown, ChevronUp, Clock, FileText, Flag, FolderSearch, Hash, Inbox, Layers, Pencil, Pin, PinOff, Plus, Search, Star, Table2, Trash2, X, Zap } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { propsOf, type Ctx } from "../lib/base";
import { PRESETS } from "../lib/canvas";
import { db, patch } from "../lib/db";
import {
  GLYPHS, moveSmart, newSmartId, orderSmart, readSmart, removeSmart, searchText, serializeSmart, SMART_PROP, SMART_SPACE, smartMatcher, suggestName, toBaseNote, upsertSmart,
  type Glyph, type SmartCtx, type SmartFolder,
} from "../lib/smart";
import { go, noteDerived, openNote, toast, useUI, useVault, type UI, type Vault } from "../lib/store";
import { Button, cx, inputCls, Sheet } from "./ui";

const GLYPH_ICON: Record<Glyph, (s: number) => ReactNode> = {
  search: (s) => <FolderSearch size={s} />, star: (s) => <Star size={s} />, book: (s) => <BookOpen size={s} />, flag: (s) => <Flag size={s} />, clock: (s) => <Clock size={s} />,
  file: (s) => <FileText size={s} />, tag: (s) => <Hash size={s} />, bolt: (s) => <Zap size={s} />, inbox: (s) => <Inbox size={s} />, layers: (s) => <Layers size={s} />,
};
export const glyphOf = (sf: Pick<SmartFolder, "glyph">, size = 15) => (GLYPH_ICON[(sf.glyph as Glyph) ?? "search"] ?? GLYPH_ICON.search)(size);
const colorOf = (c?: string | null) => (c ? PRESETS[c] ?? c : null);

// ------------------------------------------------------------------ data
export function useSmartFolders(): SmartFolder[] {
  const v = useVault();
  const raw = v.spaceMap.get(SMART_SPACE)?.props?.[SMART_PROP];
  return useMemo(() => orderSmart(readSmart(raw)), [raw]);
}
/** Read-modify-write on the fresh Inbox record (the list syncs with the space). */
async function updateSmart(fn: (list: SmartFolder[]) => SmartFolder[]) {
  const sp = await db.spaces.get(SMART_SPACE);
  if (!sp) return toast("The Inbox space is missing: can't save smart folders", undefined, { icon: "error" });
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

// ------------------------------------------------------------------ editor (one host, opened from anywhere)
type Draft = Partial<SmartFolder>;
let draft: Draft | null = null;
const subs = new Set<() => void>();
export function openSmartEditor(d: Draft) { draft = { ...d }; subs.forEach((f) => f()); }
const closeEditor = () => { draft = null; subs.forEach((f) => f()); };
const useDraft = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => draft);

/** Mount once (Palette mounts it): the "Save as smart folder" / edit sheet. */
export function SmartEditorHost() {
  const d = useDraft();
  return d ? <SmartEditor key={d.id ?? "new"} init={d} /> : null;
}

function SmartEditor({ init }: { init: Draft }) {
  const v = useVault();
  const existing = !!init.id;
  const [name, setName] = useState(init.name ?? "");
  const [query, setQuery] = useState(init.query ?? "");
  const [filters, setFilters] = useState<string[]>(init.filters ?? []);
  const [match, setMatch] = useState<"and" | "or">(init.match ?? "and");
  const [glyph, setGlyph] = useState<string>(init.glyph ?? "search");
  const [color, setColor] = useState<string | null>(init.color ?? null);
  const [pinned, setPinned] = useState(!!init.pinned);
  const ctx = useMemo(() => smartCtx(v), [v]);
  const rows = filters.filter((f) => f.trim());
  const sample = useMemo(() => v.notes.filter(smartMatcher({ query, filters: rows, match }, ctx)), [v, query, rows.join("\n"), match, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = (): SmartFolder => ({ id: init.id ?? newSmartId(), name: name.trim() || suggestName(query), query: query.trim(), filters: rows.length ? rows : undefined, match, glyph, color, pinned, sort: init.sort ?? 0 });
  const save = async () => {
    const sf = value();
    await updateSmart((l) => upsertSmart(l, existing ? sf : { ...sf, sort: undefined }));
    closeEditor();
    if (!existing) { toast(`Saved smart folder “${sf.name}”`, { label: "Open", run: () => openSmart(sf) }, { icon: "check" }); }
  };
  const asBase = async () => {
    const sf = value();
    const { body, dropped } = toBaseNote(sf);
    const n = await createNote({ type: "base", title: sf.name, body, spaceId: SMART_SPACE });
    closeEditor();
    openNote(n.id, "read");
    toast(`Created base “${sf.name}”`, undefined, { icon: "check", sub: dropped.length ? `Not carried over: ${dropped.join(", ")}` : undefined });
  };
  const del = async () => {
    const id = init.id!;
    const before = (await db.spaces.get(SMART_SPACE))?.props?.[SMART_PROP];
    const old = readSmart(before).find((x) => x.id === id);
    await updateSmart((l) => removeSmart(l, id));
    closeEditor();
    if (old) toast(`Deleted smart folder “${old.name}”`, { label: "Undo", run: () => void updateSmart((l) => upsertSmart(l, old)) });
  };
  return (
    <Sheet open onClose={closeEditor} title={existing ? "Edit smart folder" : "Save as smart folder"}>
      <div className="flex flex-col gap-3.5 text-[13px]">
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium text-muted">Name</span>
          <input autoFocus={!existing} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestName(query)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium text-muted">Search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="tag:#llm status:learning" className={cx(inputCls, "font-mono text-[12.5px]")} spellCheck={false} />
          <span className="text-[11.5px] leading-4 text-muted">Operators: tag: type: status: in: space: is:pinned, due:week|today|overdue, has:/no: (links, backlinks, tasks, any property), updated:7d, created:&gt;30d</span>
        </label>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2"><span className="flex-1 text-[12px] font-medium text-muted">Filter rows (Bases syntax)</span>
            {rows.length > 1 && <div className="flex rounded-[6px] border border-line p-px text-[11.5px]">{(["and", "or"] as const).map((m) => <button key={m} onClick={() => setMatch(m)} className={cx("h-6 rounded-[5px] px-2", match === m ? "bg-surface-2 font-semibold" : "text-muted")}>{m === "and" ? "All" : "Any"}</button>)}</div>}
          </div>
          {filters.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={f} onChange={(e) => setFilters((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder='due < today()' className={cx(inputCls, "font-mono text-[12.5px]")} spellCheck={false} />
              <button aria-label="Remove filter row" onClick={() => setFilters((xs) => xs.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => setFilters((xs) => [...xs, ""])} className="flex h-8 items-center gap-1.5 self-start rounded-[6px] px-1 text-muted hover:text-ink"><Plus size={13} />Add filter row</button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {GLYPHS.map((g) => (
            <button key={g} aria-label={`Glyph ${g}`} aria-pressed={glyph === g} onClick={() => setGlyph(g)} className={cx("flex size-9 items-center justify-center rounded-[8px] border", glyph === g ? "border-accent text-ink" : "border-transparent text-muted hover:bg-surface-2")} style={glyph === g && colorOf(color) ? { color: colorOf(color)! } : undefined}>{GLYPH_ICON[g](16)}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button title="No colour" aria-label="No colour" onClick={() => setColor(null)} className={cx("size-7 rounded-full border border-line", !color && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]")} />
          {Object.keys(PRESETS).map((k) => <button key={k} aria-label={`Colour ${k}`} onClick={() => setColor(k)} className={cx("size-7 rounded-full", color === k && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]")} style={{ background: PRESETS[k] }} />)}
          <span className="flex-1" />
          <button onClick={() => setPinned((p) => !p)} aria-pressed={pinned} className={cx("flex h-8 items-center gap-1.5 rounded-[6px] px-2", pinned ? "text-accent" : "text-muted hover:text-ink")}>{pinned ? <Pin size={14} /> : <PinOff size={14} />}{pinned ? "Pinned" : "Pin"}</button>
        </div>
        <div className="rounded-[8px] border border-line bg-bg px-2.5 py-2">
          <div className="text-[12px] text-muted">{sample.length} matching note{sample.length === 1 ? "" : "s"}</div>
          {sample.slice(0, 4).map((n) => <div key={n.id} dir="auto" className="truncate text-[12.5px]">{n.title}</div>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" onClick={() => void save()} disabled={!query.trim() && !rows.length}>{existing ? "Save" : "Save smart folder"}</Button>
          <Button onClick={() => void asBase()} disabled={!query.trim() && !rows.length} title="Create a base note (database view) with the same filters"><Table2 size={14} />Save as base</Button>
          <span className="flex-1" />
          {existing && <Button variant="ghost" className="text-bad" onClick={() => void del()}><Trash2 size={14} />Delete</Button>}
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ sidebar section
export function SidebarSmartFolders() {
  const v = useVault();
  const ui = useUI();
  const list = useSmartFolders();
  const [menu, setMenu] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const ctx = useMemo(() => smartCtx(v), [v]);
  const counts = useMemo(() => new Map(list.map((sf) => [sf.id, v.notes.filter(smartMatcher(sf, ctx)).length])), [list, v, ctx]);
  const active = ui.view === "notes" ? smartIdOf(ui) : null;
  return (
    <div className="px-2 pt-3.5" data-smart-folders>
      <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        <span>Smart folders</span>
        <button title="New smart folder" aria-label="New smart folder" className="hover:text-ink" onClick={() => openSmartEditor({ query: scopeQuery(v, ui) })}><Plus size={14} /></button>
      </div>
      {!list.length && <div className="px-2 py-1 text-[12px] text-muted">Save a search to keep it here.</div>}
      {list.map((sf) => {
        const on = active === sf.id;
        const c = colorOf(sf.color);
        return (
          <div key={sf.id} className={cx("group relative flex h-7 items-center gap-[7px] rounded-[6px] pe-2 ps-2", on ? "bg-surface-2 font-semibold" : "font-[450] hover:bg-surface-2")} onContextMenu={(e) => { e.preventDefault(); setMenu(sf.id); }}>
            <span className={cx("flex w-4 shrink-0 justify-center", !c && (on ? "text-accent" : "text-muted"))} style={c ? { color: c } : undefined}>{glyphOf(sf, 14)}</span>
            {rename === sf.id ? (
              <input autoFocus defaultValue={sf.name} dir="auto" className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1 outline-none"
                onBlur={(e) => { setRename(null); const n = e.target.value.trim(); if (n && n !== sf.name) void updateSmart((l) => upsertSmart(l, { ...sf, name: n })); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(null); }} />
            ) : (
              <button dir="auto" className="min-w-0 flex-1 truncate text-start" title={sf.query} onClick={() => openSmart(sf)} onDoubleClick={() => setRename(sf.id)}>{sf.name}</button>
            )}
            {sf.pinned && <Pin size={11} className="shrink-0 text-muted group-hover:hidden" />}
            <span className="text-[11px] tabular-nums text-muted group-hover:hidden">{counts.get(sf.id) ?? 0}</span>
            <button className="hidden text-muted hover:text-ink group-hover:block" onClick={() => setMenu(sf.id)} aria-label="Smart folder menu">⋯</button>
            {menu === sf.id && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
                <div className="absolute left-6 top-full z-40 w-52 rounded-[10px] border border-line bg-surface p-1 shadow-xl fade-in" onClick={() => setMenu(null)}>
                  {([
                    [<Pencil size={13} key="e" />, "Edit…", () => openSmartEditor(sf)],
                    [<Pencil size={13} key="r" />, "Rename", () => setRename(sf.id)],
                    [sf.pinned ? <PinOff size={13} key="p" /> : <Pin size={13} key="p" />, sf.pinned ? "Unpin" : "Pin to top", () => void updateSmart((l) => upsertSmart(l, { ...sf, pinned: !sf.pinned }))],
                    [<ChevronUp size={13} key="u" />, "Move up", () => void updateSmart((l) => moveSmart(l, sf.id, -1))],
                    [<ChevronDown size={13} key="d" />, "Move down", () => void updateSmart((l) => moveSmart(l, sf.id, 1))],
                    [<Table2 size={13} key="b" />, "Save as base", async () => { const { body } = toBaseNote(sf); openNote((await createNote({ type: "base", title: sf.name, body, spaceId: SMART_SPACE })).id, "read"); }],
                  ] as [ReactNode, string, () => void][]).map(([ic, l, fn]) => <button key={l} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={fn}><span className="text-muted">{ic}</span>{l}</button>)}
                  <div className="flex gap-1 px-2 py-1.5">
                    <button title="No colour" aria-label="No colour" className="size-5 rounded-full border border-line" onClick={() => void updateSmart((l) => upsertSmart(l, { ...sf, color: null }))} />
                    {Object.keys(PRESETS).map((k) => <button key={k} aria-label={`Colour ${k}`} className="size-5 rounded-full" style={{ background: PRESETS[k] }} onClick={() => void updateSmart((l) => upsertSmart(l, { ...sf, color: k }))} />)}
                  </div>
                  <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-bad hover:bg-surface-2" onClick={async () => {
                    await updateSmart((l) => removeSmart(l, sf.id));
                    if (active === sf.id) go("notes", { filter: null });
                    toast(`Deleted smart folder “${sf.name}”`, { label: "Undo", run: () => void updateSmart((l) => upsertSmart(l, sf)) });
                  }}><Trash2 size={13} />Delete</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ note list: search box + smart folder header
/** Desktop note-list search box: filters the list with the search operators; "Save" turns it into a smart folder. */
export function NoteListQueryBar({ query, setQuery, count }: { query: string; setQuery: (q: string) => void; count: number }) {
  const v = useVault();
  const ui = useUI();
  const list = useSmartFolders();
  const sid = smartIdOf(ui);
  const sf = sid ? list.find((x) => x.id === sid) : null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5" data-list-query>
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-line bg-bg px-2 text-muted focus-within:border-accent">
        <Search size={13} className="shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder={sf ? `Within “${sf.name}”…` : "Filter… tag:#llm status:learning"} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-muted" spellCheck={false} />
        {query && <span className="shrink-0 text-[11px] tabular-nums">{count}</span>}
        {query && <button aria-label="Clear search" onClick={() => setQuery("")} className="shrink-0 hover:text-ink"><X size={12} /></button>}
      </label>
      {(query.trim() || sf) && (
        <button title={sf && !query.trim() ? "Edit smart folder" : "Save as smart folder"} aria-label={sf && !query.trim() ? "Edit smart folder" : "Save as smart folder"}
          onClick={() => (sf && !query.trim() ? openSmartEditor(sf) : openSmartEditor({ query: [sf ? sf.query : scopeQuery(v, ui), query.trim()].filter(Boolean).join(" "), filters: sf?.filters, match: sf?.match }))}
          className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink">
          {sf && !query.trim() ? <Pencil size={14} /> : <BookmarkPlus size={15} />}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ phone: rows in the folders sheet
export function PhoneSmartRows({ onPick }: { onPick: () => void }) {
  const v = useVault();
  const ui = useUI();
  const list = useSmartFolders();
  const ctx = useMemo(() => smartCtx(v), [v]);
  const counts = useMemo(() => new Map(list.map((sf) => [sf.id, v.notes.filter(smartMatcher(sf, ctx)).length])), [list, v, ctx]);
  const active = smartIdOf(ui);
  return (
    <div className="mt-2 border-t border-line pt-2" data-phone-smart>
      <div className="flex items-center px-3 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-[.06em] text-muted">
        <span className="flex-1">Smart folders</span>
        <button aria-label="New smart folder" onClick={() => { onPick(); openSmartEditor({ query: scopeQuery(v, ui) }); }} className="flex size-11 items-center justify-center"><Plus size={17} /></button>
      </div>
      {!list.length && <div className="px-3 pb-2 text-[13px] text-muted">Save a search from the search screen to keep it here.</div>}
      {list.map((sf) => {
        const on = active === sf.id;
        const c = colorOf(sf.color);
        return (
          <div key={sf.id} className={cx("flex h-12 w-full items-center gap-2.5 rounded-[10px] pe-1 ps-3", on && "bg-surface-2")}>
            <button onClick={() => { openSmart(sf); onPick(); }} className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-start">
              <span className={cx("flex w-5 justify-center", !c && "text-muted")} style={c ? { color: c } : undefined}>{glyphOf(sf, 17)}</span>
              <span dir="auto" className={cx("flex-1 truncate", on && "font-semibold")}>{sf.name}</span>
              <span className="text-[13px] text-muted">{counts.get(sf.id) ?? 0}</span>
              {on && <Check size={18} className="text-accent" />}
            </button>
            <button aria-label={`Edit ${sf.name}`} onClick={() => { onPick(); openSmartEditor(sf); }} className="flex size-11 shrink-0 items-center justify-center text-muted"><Pencil size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
