// R8-56B scope menu: vault, a space or folder, this note + its links, a tag, a plan (learning path or course /
// project), one PDF. Rows with choices open a filterable list in the same popover. Chip = folder glyph + name ▾.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../../shared/types";
import { scopeLabel, scopeNotes, type Scope } from "../../lib/ask-retrieve";
import { t } from "../../lib/i18n";
import type { Vault } from "../../lib/store";
import { Glyph } from "../Glyph";

const sameScope = (a: Scope, b: Scope) => a.kind === b.kind && (a.spaceId ?? "") === (b.spaceId ?? "") && (a.noteId ?? "") === (b.noteId ?? "") && (a.pathId ?? "") === (b.pathId ?? "")
  && (a.folderId ?? "") === (b.folderId ?? "") && (a.tag ?? "") === (b.tag ?? "");
type Page = "root" | "space" | "tag" | "plan" | "pdf";
const AC = "color-mix(in srgb,var(--accent) 16%,transparent)";

export function ScopeMenu({ scope, setScope, note, v, spaceId, openSignal }: { scope: Scope; setScope: (s: Scope) => void; note?: Note; v: Vault; spaceId: string; openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>("root");
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (openSignal) { setPage("root"); setOpen(true); } }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (page !== "root") setPage("root"); else setOpen(false); } };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc, true); };
  }, [open, page]);
  const live = useMemo(() => v.notes.filter((n) => !n.deleted), [v.notes]);
  const count = (s: Scope) => scopeNotes(s, v)?.size ?? live.length;
  const pick = (s: Scope) => { setScope(s); setOpen(false); setPage("root"); setQ(""); };
  const cur = scopeLabel(scope, v);
  const curGlyph = scope.kind === "vault" ? "globe" : scope.kind === "tag" ? "tag" : scope.kind === "path" ? "timeline" : scope.kind === "file" ? "pdf" : scope.kind === "note" ? "note" : "folder";
  const row = "flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-start text-[13px]";
  const hint = "text-[11px] text-muted";

  const root: { id: Page | "vault" | "note"; glyph: string; label: string; n?: string; on: boolean; off?: boolean }[] = [
    { id: "vault", glyph: "globe", label: t("Whole vault"), n: t("{n} notes", { n: live.length.toLocaleString() }), on: scope.kind === "vault" && !scope.noteIds },
    { id: "space", glyph: "folder", label: t("A space or folder…"), on: scope.kind === "space" || scope.kind === "folder" },
    { id: "note", glyph: "note", label: t("This note + its links"), on: scope.kind === "note", off: !note },
    { id: "tag", glyph: "tag", label: t("A tag…"), on: scope.kind === "tag" },
    { id: "plan", glyph: "timeline", label: t("A plan (course, project)…"), on: scope.kind === "path" },
    { id: "pdf", glyph: "pdf", label: t("A PDF or attachment…"), on: scope.kind === "file" },
  ];
  const f = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const lists: Record<Exclude<Page, "root">, { key: string; glyph: string; label: string; sub?: string; s: Scope }[]> = {
    space: [
      ...v.spaces.filter((s) => !s.deleted).map((s) => ({ key: s.id, glyph: "folder", label: s.name, sub: t("Space"), s: { kind: "space", spaceId: s.id } as Scope })),
      ...v.folders.filter((x) => !x.deleted).map((x) => ({ key: x.id, glyph: "folder", label: x.name, sub: v.spaceMap.get(x.spaceId)?.name, s: { kind: "folder", folderId: x.id } as Scope })),
    ],
    tag: v.tags.map(([tg, n]) => ({ key: tg, glyph: "tag", label: `#${tg}`, sub: String(n), s: { kind: "tag", tag: tg } as Scope })),
    plan: [
      ...live.filter((n) => n.type === "path").map((n) => ({ key: n.id, glyph: "timeline", label: n.title, sub: t("Learning path"), s: { kind: "path", pathId: n.id } as Scope })),
      ...v.spaces.filter((s) => !s.deleted && (s.kind === "course" || s.kind === "project")).map((s) => ({ key: s.id, glyph: s.kind === "course" ? "lesson" : "task", label: s.name, sub: s.kind === "course" ? t("Course") : t("Project"), s: { kind: "space", spaceId: s.id } as Scope })),
    ],
    pdf: live.filter((n) => n.type === "pdf").map((n) => ({ key: n.id, glyph: "pdf", label: n.title, sub: v.spaceMap.get(n.spaceId)?.name, s: { kind: "file", noteId: n.id } as Scope })),
  };
  void spaceId;
  const items = page === "root" ? [] : lists[page].filter((x) => f(x.label));
  return (
    <div ref={ref} className="relative shrink-0">
      {open && (
        <div role="listbox" aria-label={t("Search in")} className="absolute bottom-[calc(100%+8px)] start-0 z-40 flex max-h-[360px] w-[320px] max-w-[90vw] flex-col rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-[0_16px_40px_rgb(0_0_0/.35)]" data-scope-menu>
          {page === "root" ? root.map((r) => (
            <button key={r.id} role="option" aria-selected={r.on} disabled={r.off} onClick={() => (r.id === "vault" ? pick({ kind: "vault" }) : r.id === "note" ? note && pick({ kind: "note", noteId: note.id }) : (setPage(r.id as Page), setQ("")))}
              className={`${row} disabled:opacity-40 hover:bg-bg`} style={{ background: r.on ? AC : undefined }}>
              <Glyph name={r.glyph} size={15} color="var(--muted)" /><span className="flex-1 truncate">{r.label}</span><span className={hint}>{r.n ?? (r.id === "note" && note ? count({ kind: "note", noteId: note.id }) + " " + t("notes") : r.on ? count(scope) + " " + t("notes") : "")}</span>
            </button>
          )) : (
            <>
              <div className="flex items-center gap-1 px-1 pb-1.5">
                <button aria-label={t("Back")} onClick={() => { setPage("root"); setQ(""); }} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-bg"><span aria-hidden>‹</span></button>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} dir="auto" placeholder={t("Filter")} aria-label={t("Filter")} className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-bg px-2 text-[12.5px] outline-none focus:border-accent" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {items.length === 0 && <span className="px-2.5 py-3 text-[12.5px] text-muted">{t("Nothing here yet.")}</span>}
                {items.map((x) => (
                  <button key={x.key} role="option" aria-selected={sameScope(x.s, scope)} onClick={() => pick(x.s)} className={`${row} hover:bg-bg`} style={{ background: sameScope(x.s, scope) ? AC : undefined }}>
                    <Glyph name={x.glyph} size={15} color="var(--muted)" /><span dir="auto" className="flex-1 truncate">{x.label}</span><span className={`${hint} max-w-[110px] truncate`}>{x.sub}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <button aria-haspopup="listbox" aria-expanded={open} aria-label={t("Search in: {scope}", { scope: cur })} onClick={() => { setOpen((o) => !o); setPage("root"); setQ(""); }} data-scope
        className="flex h-[30px] max-w-[240px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px]" style={{ borderColor: open ? "var(--accent)" : "var(--border)", background: open ? AC : "transparent" }}>
        <Glyph name={curGlyph} size={13} color="var(--text)" /><span dir="auto" className="truncate">{scope.noteIds?.length ? t("{n} chosen notes", { n: scope.noteIds.length }) : cur}</span><span aria-hidden>▾</span>
      </button>
    </div>
  );
}
