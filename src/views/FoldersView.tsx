// Folders view (design Lumen 32 · R6-32E / J): the whole folder tree of a space (or all spaces) as one virtualised
// list. Only open folders render; while searching, parents of matches auto-expand and the search box shows
// "23 in 2,140". Sticky path headers ("AI Engineer › 03 Deep learning") stay on top while scrolling.
// Folders with more than `pageSize` notes page ("Show 200 more").
import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Note } from "../../shared/types";
import { FileName, isFileName } from "../components/file-name";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { fmtNum, t } from "../lib/i18n";
import { useScale } from "../lib/scale-prefs";
import { normalize } from "../lib/search";
import { openNote, useUI, useVault } from "../lib/store";
import { BIG_PAL } from "./graph-big";

type Row =
  | { k: "head"; id: string; label: string }
  | { k: "folder"; id: string; f: Folder; depth: number; open: boolean; count: number; color: string }
  | { k: "note"; id: string; n: Note; depth: number }
  | { k: "more"; id: string; folder: string; depth: number; n: number }
  | { k: "rest"; id: string; label: string };
const ROW = 28, HEAD = 26;
const rowH = (r: Row) => (r.k === "head" || r.k === "rest" ? HEAD : ROW);

/** Splits a title around the first match (accent-bold hit, like the design). */
function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = normalize(text).indexOf(normalize(q));
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b className="font-semibold text-accent">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>;
}

export function FoldersView() {
  const v = useVault();
  const ui = useUI();
  const scale = useScale();
  const phone = typeof innerWidth === "number" && innerWidth < 768;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const [hitCap, setHitCap] = useState(scale.pageSize);
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(800);
  useEffect(() => { const el = scroller.current; if (!el) return; const ro = new ResizeObserver(() => setHeight(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, []);

  const all = ui.spaceId === "all";
  const idx = useMemo(() => {
    const folders = [...v.folderMap.values()].filter((f) => !f.deleted && (all || f.spaceId === ui.spaceId));
    const kids = new Map<string, Folder[]>(), tops: Folder[] = [];
    for (const f of folders) if (f.parentId && v.folderMap.get(f.parentId)) (kids.get(f.parentId) ?? kids.set(f.parentId, []).get(f.parentId)!).push(f); else tops.push(f);
    const by = (a: Folder, b: Folder) => a.spaceId.localeCompare(b.spaceId) || a.sort - b.sort || a.name.localeCompare(b.name);
    tops.sort(by); kids.forEach((l) => l.sort(by));
    const notes = v.notes.filter((n) => (all || n.spaceId === ui.spaceId) && n.folderId && v.folderMap.has(n.folderId));
    const direct = new Map<string, Note[]>(), total = new Map<string, number>();
    const chain = (id: string | null) => { const out: string[] = []; for (let f = id ? v.folderMap.get(id) : undefined; f && out.length < 64 && !out.includes(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) out.push(f.id); return out; };
    for (const n of notes) { (direct.get(n.folderId!) ?? direct.set(n.folderId!, []).get(n.folderId!)!).push(n); for (const f of chain(n.folderId)) total.set(f, (total.get(f) ?? 0) + 1); }
    direct.forEach((l) => l.sort((a, b) => a.title.localeCompare(b.title)));
    let depth = 0;
    const walk = (f: Folder, d: number) => { depth = Math.max(depth, d); for (const k of kids.get(f.id) ?? []) walk(k, d + 1); };
    tops.forEach((f) => walk(f, 1));
    const color = new Map<string, string>();
    tops.forEach((f, i) => { const c = f.color ?? BIG_PAL[i % BIG_PAL.length]; const paint = (x: Folder) => { color.set(x.id, c); (kids.get(x.id) ?? []).forEach(paint); }; paint(f); });
    return { folders, kids, tops, direct, total, notes, chain, depth, color };
  }, [v, all, ui.spaceId]);
  const spaceName = (id: string) => v.spaceMap.get(id)?.name ?? "";

  // Matches: note titles + folder names.
  const query = q.trim();
  const match = useMemo(() => {
    if (!query) return null;
    const nq = normalize(query);
    const notes = idx.notes.filter((n) => normalize(n.title).includes(nq));
    const folders = idx.folders.filter((f) => normalize(f.name).includes(nq));
    const keep = new Set<string>();
    for (const n of notes) for (const f of idx.chain(n.folderId)) keep.add(f);
    for (const f of folders) for (const x of idx.chain(f.id)) keep.add(x);
    return { notes, noteSet: new Set(notes.map((n) => n.id)), folders, keep, total: notes.length + folders.length };
  }, [query, idx]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let shown = 0, hidden = 0;
    const hiddenIn = new Set<string>();
    const folder = (f: Folder, depth: number) => {
      if (match && !match.keep.has(f.id)) return;
      const isOpen = match ? true : open.has(f.id);
      out.push({ k: "folder", id: f.id, f, depth, open: isOpen, count: idx.total.get(f.id) ?? 0, color: idx.color.get(f.id) ?? "var(--muted)" });
      if (!isOpen) return;
      for (const k of idx.kids.get(f.id) ?? []) folder(k, depth + 1);
      const list = idx.direct.get(f.id) ?? [];
      if (match) {
        for (const n of list) if (match.noteSet.has(n.id)) { if (shown < hitCap) { out.push({ k: "note", id: n.id, n, depth: depth + 1 }); shown++; } else { hidden++; hiddenIn.add(f.id); } }
        return;
      }
      const cap = scale.pageSize * (1 + (pages[f.id] ?? 0));
      for (const n of list.slice(0, cap)) out.push({ k: "note", id: n.id, n, depth: depth + 1 });
      if (list.length > cap) out.push({ k: "more", id: `more:${f.id}`, folder: f.id, depth: depth + 1, n: Math.min(scale.pageSize, list.length - cap) });
    };
    for (const f of idx.tops) {
      if (match && !match.keep.has(f.id)) continue;
      out.push({ k: "head", id: `h:${f.id}`, label: `${spaceName(f.spaceId)} › ${f.name}` });
      folder(f, 0);
    }
    if (hidden) out.push({ k: "rest", id: "rest", label: t("+ {n} more matches in {f} folders", { n: hidden, f: hiddenIn.size }) });
    return out;
  }, [idx, match, open, pages, hitCap, scale.pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Virtualisation: offsets once per row list, render the window around the scroll position.
  const offs = useMemo(() => { const o: number[] = []; let y = 0; for (const r of rows) { o.push(y); y += rowH(r); } o.push(y); return o; }, [rows]);
  const totalH = offs[offs.length - 1];
  const first = Math.max(0, upper(offs, top) - 8), last = Math.min(rows.length, upper(offs, top + height) + 8);
  // Sticky path header: the last header above the viewport top.
  let stick: Row | null = null;
  for (let i = Math.min(rows.length - 1, upper(offs, top)); i >= 0; i--) if (rows[i].k === "head") { stick = rows[i]; break; }
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const headerCls = "flex items-center gap-1.5 bg-surface px-1.5 text-[11px] text-muted";

  const render = (r: Row) => {
    if (r.k === "head") return <div className={headerCls} style={{ height: HEAD }} dir="auto">{r.label}</div>;
    if (r.k === "rest") return <button onClick={() => setHitCap((c) => c + scale.pageSize)} className="flex w-full items-center px-1.5 text-start text-[11.5px] text-muted hover:text-ink" style={{ height: HEAD }}>{r.label}</button>;
    const pad = 6 + r.depth * 14;
    if (r.k === "more") return <button onClick={() => setPages((p) => ({ ...p, [r.folder]: (p[r.folder] ?? 0) + 1 }))} className="flex w-full items-center rounded-[6px] text-start text-[12px] text-link hover:bg-surface-2" style={{ height: ROW, paddingInlineStart: pad + 16 }}>{t("Show {n} more", { n: r.n })}</button>;
    if (r.k === "folder") return (
      <button onClick={() => !match && toggle(r.id)} aria-expanded={r.open} title={r.f.name} className="flex w-full items-center gap-1.5 rounded-[6px] pe-1.5 text-start hover:bg-surface-2" style={{ height: ROW, paddingInlineStart: pad }}>
        <span className="w-2.5 text-[9px] text-muted">{r.open ? "▾" : "▸"}</span>
        <Glyph name="folder" size={14} color={r.color} />
        <span className="min-w-0 flex-1 truncate" dir="auto"><Hit text={r.f.name} q={query} /></span>
        <span className="text-[11px] text-muted">{fmtNum(r.count)}</span>
      </button>
    );
    const sel = ui.noteId === r.n.id;
    return (
      <button onClick={() => openNote(r.n.id)} title={r.n.title} className={cx("flex w-full items-center gap-1.5 rounded-[6px] pe-1.5 text-start hover:bg-surface-2", sel && "bg-surface-2")} style={{ height: ROW, paddingInlineStart: pad }}>
        <span className="w-2.5" />
        <Glyph name={r.n.type === "lesson" ? "lesson" : r.n.type === "journal" ? "journal" : "note"} size={14} color="var(--muted)" />
        {isFileName(r.n.title) && !query ? <FileName name={r.n.title} className="flex-1" /> : <span className="min-w-0 flex-1 truncate" dir="auto"><Hit text={r.n.title} q={query} /></span>}
      </button>
    );
  };

  const noteCount = idx.notes.length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-[13px]">
      <div className={cx("flex shrink-0 items-center gap-2.5 border-b border-line", phone ? "safe-t h-[52px] px-3" : "h-12 px-5")}>
        <Glyph name="folder" size={18} color="var(--accent)" />
        <b className="whitespace-nowrap text-[15px] font-[650]">{t("Folders")}</b>
        {!phone && <span className="min-w-0 truncate text-muted">{t("{n} note|{n} notes", { n: noteCount })}{query ? ` · ${t("searching “{q}”", { q: query })}` : ""}</span>}
      </div>
      <div className="flex min-h-0 flex-1" style={{ backgroundImage: "radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1px,transparent 1.2px)", backgroundSize: "22px 22px" }}>
        <div className={cx("flex min-h-0 flex-col bg-surface p-2", phone ? "w-full" : "w-[380px] border-e border-line")}>
          <label className={cx("mb-1.5 flex h-8 shrink-0 items-center gap-2 rounded-[7px] border bg-bg px-2.5", query ? "border-accent" : "border-line focus-within:border-accent")}>
            <Glyph name="search" size={13} color="var(--muted)" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setHitCap(scale.pageSize); scroller.current?.scrollTo({ top: 0 }); }} placeholder={t("Find a note or folder")} aria-label={t("Find a note or folder")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
            {match && <span className="whitespace-nowrap text-[11.5px] text-muted">{t("{n} in {total}", { n: match.total, total: noteCount })}</span>}
          </label>
          <div ref={scroller} onScroll={(e) => setTop(e.currentTarget.scrollTop)} className="relative min-h-0 flex-1 overflow-y-auto" data-virtual-rows={last - first}>
            {stick && top > 0 && <div className="sticky top-0 z-10" style={{ marginBottom: -HEAD }}>{render(stick)}</div>}
            <div className="relative" style={{ height: totalH }}>
              {rows.slice(first, last).map((r, i) => <div key={r.id} className="absolute inset-x-0" style={{ top: offs[first + i] }}>{render(r)}</div>)}
            </div>
            {!rows.length && <p className="p-3 text-[12px] text-muted">{query ? t("No note or folder matches “{q}”.", { q: query }) : t("No folders in this space yet.")}</p>}
          </div>
          <span className="shrink-0 px-1.5 pt-2 text-[11.5px] text-muted">{t("Only open folders render. Parents of matches auto-expand.")}</span>
        </div>
        {!phone && (
          <div className="flex flex-1 flex-col gap-2.5 p-6">
            <b className="font-semibold">{t("{n} notes · {f} folders · {d} levels deep", { n: noteCount, f: idx.folders.length, d: idx.depth })}</b>
            <span className="max-w-[420px] leading-[19px] text-muted">{t("Folders with more than {n} notes open as a paged list (“Show {n} more”). Breadcrumb collapses past three levels. Drag-and-drop autoscrolls and auto-expands after 600 ms.", { n: scale.pageSize })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Index of the last offset ≤ y (binary search). */
function upper(offs: number[], y: number) {
  let lo = 0, hi = offs.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= y) lo = m; else hi = m - 1; }
  return Math.max(0, lo);
}
