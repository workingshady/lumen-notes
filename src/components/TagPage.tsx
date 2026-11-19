/* Tags (design R6 · TAGS, "Lumen 30 Sidebars Tags Spaces" R6-30M/N/O):
 * - TagPage: one (nested) tag: child tags as pills, its notes with status, "Often used together" bars, colour, actions.
 * - Tag ⋯ menu (openTagMenu, mounted once by TagMenuHost): Pin to top, Rename… (F2), Merge into…, Move under…,
 *   Save as smart folder, Delete tag (Undo), colour row. The sidebar opens it with openTagMenu(tag, anchorRect).
 * Logic: lib/tag-tree.ts (tree, colours, pins) + lib/tag-ops.ts (rewrites every note). Format: docs/TAGS.md. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Note } from "../../shared/types";
import { t } from "../lib/i18n";
import { getUI, openNote, setUI, toast, useVault } from "../lib/store";
import { deleteTag, renameTag, setTagColor, toggleTagPin } from "../lib/tag-ops";
import { cleanTag, findTag, fuzzyTags, openTag, presetColor, TAG_PRESET_KEYS, tagColor, tagTree, underTag, useTagMeta } from "../lib/tag-tree";
import { Glyph } from "./Glyph";
import { listTime } from "./NoteList";
import { openSmartEditor } from "./SmartFolders";
import { useAllTags } from "./TagPicker";
import { cx, STATUS_COLOR } from "./ui";

// ------------------------------------------------------------------ actions (shared by the page and the menu)
type DialogKind = "rename" | "merge" | "move";
let dialog: { kind: DialogKind; tag: string } | null = null;
let menu: { tag: string; x: number; y: number } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const useHost = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => `${menu?.tag ?? ""}|${menu?.x}|${menu?.y}|${dialog?.kind ?? ""}|${dialog?.tag ?? ""}`);

/** Open the tag ⋯ menu next to an element (or at a point). */
export function openTagMenu(tag: string, at: DOMRect | { x: number; y: number }) {
  const r = "left" in at ? { x: at.left, y: at.bottom + 4 } : at;
  menu = { tag, x: r.x, y: r.y }; emit();
}
export const closeTagMenu = () => { menu = null; emit(); };
/** Rename / Merge into / Move under dialog. */
export function openTagDialog(kind: DialogKind, tag: string) { menu = null; dialog = { kind, tag }; emit(); }

/** Apply a rename-like change with an Undo toast; follows the tag if its page is open. */
async function applyRename(from: string, to: string, verb: "renamed" | "merged" | "moved") {
  const r = await renameTag(from, to);
  const ui0 = getUI();
  if (ui0.tag && underTag(ui0.tag, from)) setUI({ tag: to + ui0.tag.slice(from.length) });
  const msg = verb === "merged" ? t("Merged #{from} into #{to} · {n} notes", { from, to, n: r.count }) : verb === "moved" ? t("Moved #{from} to #{to} · {n} notes", { from, to, n: r.count }) : t("Renamed #{from} to #{to} · {n} notes", { from, to, n: r.count });
  toast(msg, { label: t("Undo"), run: () => { void r.undo(); setUI((u) => (u.tag && underTag(u.tag, to) ? { tag: from + u.tag.slice(to.length) } : {})); } }, { icon: "check" });
}

export async function removeTag(tag: string) {
  const r = await deleteTag(tag);
  setUI((u) => (u.tag && underTag(u.tag, tag) ? { tag: null } : {}));
  toast(t("Deleted #{tag} from {n} notes", { tag, n: r.count }), { label: t("Undo"), run: () => void r.undo() }, { icon: "trash" });
}
export const saveTagAsSmart = (tag: string, color?: string | null) => openSmartEditor({ name: `#${tag}`, query: `tag:#${tag}`, glyph: "tag", color: color ?? null });

// ------------------------------------------------------------------ colour row
export function ColorRow({ tag, size = 22, gap = 8, ring = "var(--surface)" }: { tag: string; size?: number; gap?: number; ring?: string }) {
  const { colors } = useTagMeta();
  const cur = colors[tag];
  return (
    <div className="flex items-center" style={{ gap }} role="radiogroup" aria-label={t("Colour")}>
      {TAG_PRESET_KEYS.map((k) => (
        <button key={k} role="radio" aria-checked={cur === k} aria-label={t("Colour {n}", { n: k })} onClick={() => void setTagColor(tag, cur === k ? null : k)}
          className="shrink-0 rounded-full" style={{ width: size, height: size, background: presetColor(k), boxShadow: cur === k ? `0 0 0 2px ${ring}, 0 0 0 3.5px var(--text)` : "none" }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ host: menu + dialogs (mount once)
export function TagMenuHost() {
  useHost();
  // also reachable without importing this module: dispatchEvent(new CustomEvent("lumen:tag-menu", { detail: { tag, x, y } }))
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent<{ tag: string; x: number; y: number; dialog?: DialogKind }>).detail; if (!d?.tag) return; if (d.dialog) openTagDialog(d.dialog, d.tag); else openTagMenu(d.tag, { x: d.x, y: d.y }); };
    addEventListener("lumen:tag-menu", f);
    return () => removeEventListener("lumen:tag-menu", f);
  }, []);
  return <>{menu && <TagMenu key={menu.tag} tag={menu.tag} x={menu.x} y={menu.y} />}{dialog && <TagDialog key={dialog.kind + dialog.tag} kind={dialog.kind} tag={dialog.tag} />}</>;
}

function TagMenu({ tag, x, y }: { tag: string; x: number; y: number }) {
  const { colors, pinned } = useTagMeta();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) }); }
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) closeTagMenu(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeTagMenu(); if (e.key === "F2") { e.preventDefault(); openTagDialog("rename", tag); } };
    addEventListener("mousedown", down); addEventListener("keydown", key);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [x, y, tag]);
  const isPinned = pinned.includes(tag);
  const run = (f: () => void) => () => { closeTagMenu(); f(); };
  const items: ({ g: string; l: string; k?: string; danger?: boolean; on: () => void } | "sep")[] = [
    { g: "pin", l: isPinned ? t("Unpin") : t("Pin to top"), on: run(() => void toggleTagPin(tag)) },
    { g: "d-draft", l: t("Rename…"), k: "F2", on: () => openTagDialog("rename", tag) },
    { g: "merge", l: t("Merge into…"), on: () => openTagDialog("merge", tag) },
    { g: "tag-nested", l: t("Move under…"), on: () => openTagDialog("move", tag) },
    "sep",
    { g: "smart-folder", l: t("Save as smart folder"), on: run(() => saveTagAsSmart(tag, colors[tag])) },
    { g: "trash", l: t("Delete tag"), danger: true, on: run(() => void removeTag(tag)) },
  ];
  return (
    <div ref={ref} role="menu" aria-label={`#${tag}`} data-tag-menu className="fixed z-[60] flex w-[230px] flex-col rounded-[12px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in" style={{ left: pos.x, top: pos.y }}>
      {items.map((m, i) => m === "sep" ? <div key={i} className="m-1 h-px bg-line" /> : (
        <button key={i} role="menuitem" onClick={m.on} className={cx("flex h-8 shrink-0 items-center gap-2.5 rounded-[7px] px-2 text-start hover:bg-bg", m.danger ? "text-bad" : "text-ink")}>
          <Glyph name={m.g} size={15} /><span className="flex-1">{m.l}</span>{m.k && <span className="text-[11.5px] text-muted">{m.k}</span>}
        </button>
      ))}
      <div className="px-2 pb-1 pt-1.5"><ColorRow tag={tag} size={18} gap={6} ring="var(--surface-2)" /></div>
    </div>
  );
}

function TagDialog({ kind, tag }: { kind: DialogKind; tag: string }) {
  const all = useAllTags();
  const leaf = tag.slice(tag.lastIndexOf("/") + 1);
  const [q, setQ] = useState(kind === "rename" ? tag : "");
  const [i, setI] = useState(0);
  const close = () => { dialog = null; emit(); };
  // merge: any other tag; move under: a parent that isn't the tag itself or below it
  const hits = useMemo(() => kind === "rename" ? [] : fuzzyTags(q, all.filter(([x]) => !underTag(x, tag) && (kind === "merge" || x !== tag.slice(0, tag.lastIndexOf("/")))), 6), [q, all, kind, tag]);
  const target = (pick?: string) => {
    if (kind === "rename") return cleanTag(q);
    const p = pick ?? hits[i]?.tag ?? cleanTag(q);
    if (!p) return null;
    return kind === "merge" ? p : `${p}/${leaf}`;
  };
  const submit = async (pick?: string) => {
    const to = target(pick);
    if (!to || to === tag) return close();
    if (underTag(to, tag)) { toast(t("A tag can't move under itself"), undefined, { icon: "error" }); return; }
    close();
    await applyRename(tag, to, kind === "merge" ? "merged" : kind === "move" ? "moved" : "renamed");
  };
  const title = kind === "rename" ? t("Rename #{tag}", { tag }) : kind === "merge" ? t("Merge #{tag} into…", { tag }) : t("Move #{tag} under…", { tag });
  const preview = target();
  return (
    <div className="fixed inset-0 z-[61] flex items-start justify-center bg-[rgba(5,6,8,.5)] pt-[18vh] fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form role="dialog" aria-label={title} className="flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 text-[13px] shadow-2xl" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <span className="text-[15px] font-[650]" dir="ltr">{title}</span>
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} dir="ltr" spellCheck={false} placeholder={kind === "rename" ? "" : t("Search tags")}
          onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } }}
          onFocus={(e) => kind === "rename" && e.target.select()}
          className="h-9 rounded-[8px] border border-line bg-bg px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent" />
        {kind !== "rename" && hits.length > 0 && (
          <div className="flex flex-col">
            {hits.map((h, k) => (
              <button key={h.tag} type="button" onMouseEnter={() => setI(k)} onClick={() => void submit(h.tag)} className={cx("flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-start", k === i && "bg-surface-2")}>
                <span className="size-[7px] rounded-full bg-muted" /><span dir="ltr" className="flex-1 truncate">#{h.tag}</span><span className="text-[11.5px] text-muted">{h.count}</span>
              </button>
            ))}
          </div>
        )}
        <span className="text-[12px] text-muted" dir="ltr">{preview && preview !== tag ? `#${tag} → #${preview}` : " "}</span>
        <span className="text-[12px] text-muted">{t("Every note that uses the tag is rewritten (body and front-matter). You can undo it.")}</span>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="flex h-8 items-center rounded-[8px] border border-line px-3 hover:bg-surface-2">{t("Cancel")}</button>
          <button type="submit" className="flex h-8 items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg hover:brightness-110">{kind === "rename" ? t("Rename") : kind === "merge" ? t("Merge") : t("Move")}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ the page
const STATUS_NAME: Record<string, string> = { todo: "todo", learning: "learning", review: "review", mastered: "done" };

export function TagPage({ tag }: { tag: string }) {
  const v = useVault();
  const { colors, pinned } = useTagMeta();
  const tree = useMemo(() => tagTree(v.tags, colors, pinned), [v.tags, colors, pinned]);
  const node = findTag(tree, tag);
  const notes = useMemo(() => v.notes.filter((n) => n.tags.some((x) => underTag(x, tag))).sort((a, b) => b.updatedAt - a.updatedAt), [v.notes, tag]);
  const spaces = useMemo(() => new Set(notes.map((n) => n.spaceId)).size, [notes]);
  const co = useMemo(() => {
    const m = new Map<string, number>();
    const skip = (x: string) => underTag(x, tag) || underTag(tag, x);
    for (const n of notes) for (const x of new Set(n.tags.filter((y) => !skip(y)))) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  }, [notes, tag]);
  const color = tagColor(tag, colors) ?? "var(--muted)";
  const i = tag.lastIndexOf("/");
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "F2" && !(e.target as HTMLElement)?.closest?.("input,textarea,.cm-editor")) { e.preventDefault(); openTagDialog("rename", tag); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [tag]);
  const btn = "flex h-8 shrink-0 items-center rounded-[8px] border border-line px-3 hover:bg-surface-2";
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-8 py-6 text-[13px] leading-[1.3]" data-tag-page>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}><Glyph name="tag" size={18} color={color} /></span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span dir="ltr" className="truncate text-start text-[20px] font-[650] leading-[25px]"><span className="text-muted">#{tag.slice(0, i + 1)}</span>{tag.slice(i + 1)}</span>
          <span className="text-muted">{[t("{n} note|{n} notes", { n: notes.length }), t("{n} child tag|{n} child tags", { n: node?.children.length ?? 0 }), t("used in {n} space|used in {n} spaces", { n: spaces })].join(" · ")}</span>
        </div>
        <button className={btn} onClick={() => openTagDialog("rename", tag)} title="F2">{t("Rename")}</button>
        <button className={btn} onClick={() => openTagDialog("merge", tag)}>{t("Merge into…")}</button>
        <button ref={moreRef} aria-label={t("More tag actions")} className={cx(btn, "w-8 justify-center px-0")} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openTagMenu(tag, { x: r.right - 230, y: r.bottom + 4 }); }}><Glyph name="more" size={16} /></button>
      </div>
      {!!node?.children.length && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">{t("Child tags")}</span>
          {node.children.map((c) => (
            <button key={c.path} onClick={() => openTag(c.path)} onContextMenu={(e) => { e.preventDefault(); openTagMenu(c.path, { x: e.clientX, y: e.clientY }); }}
              className="flex h-[26px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 hover:bg-surface-2" dir="ltr">
              <span className="size-1.5 rounded-full" style={{ background: c.color ?? color }} />#{c.path}<span className="text-[11.5px] text-muted">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-4">
        <div className="min-h-0 overflow-y-auto rounded-[12px] border border-line" data-tag-notes>
          {notes.map((n, k) => <TagNoteRow key={n.id} n={n} first={k === 0} />)}
          {!notes.length && <div className="p-6 text-center text-muted">{t("No notes use #{tag} yet.", { tag })}</div>}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5">
            <span className="font-semibold">{t("Often used together")}</span>
            {co.map(([x, k]) => (
              <button key={x} onClick={() => openTag(x)} className="flex items-center gap-2 text-start" title={t("{n} note|{n} notes", { n: k })}>
                <span dir="ltr" className="w-[90px] truncate text-[12.5px]">#{x}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full" style={{ width: `${Math.round((k / Math.max(1, notes.length)) * 100)}%`, background: tagColor(x, colors) ?? "var(--muted)" }} /></span>
                <span className="w-6 text-end text-[11.5px] text-muted">{k}</span>
              </button>
            ))}
            {!co.length && <span className="text-[12.5px] text-muted">{t("No other tags on these notes yet.")}</span>}
          </div>
          <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5">
            <span className="font-semibold">{t("Colour")}</span>
            <ColorRow tag={tag} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TagNoteRow({ n, first }: { n: Note; first: boolean }) {
  return (
    <button onClick={() => openNote(n.id)} className={cx("flex h-[42px] w-full items-center gap-2.5 px-3.5 text-start hover:bg-surface", !first && "border-t border-line")}>
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
      <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{n.title || t("Untitled")}</span>
      {n.status && <span className="text-[12px] text-muted">{t(STATUS_NAME[n.status] ?? n.status)}</span>}
      <span className="w-[60px] shrink-0 text-end text-[12px] text-muted">{listTime(n.updatedAt)}</span>
    </button>
  );
}
