// Round 9 dialogs: in-app confirm (replaces window.confirm), "Move to…" fuzzy dialog (Lumen 03 1K), "Save as template" (Lumen 02).
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteType } from "../../shared/types";
import { createFolder, createNote, moveNote } from "../lib/actions";
import { t } from "../lib/i18n";
import { getVault, toast, useVault } from "../lib/store";
import { folderTree } from "./note-list-desk";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { Button, cx } from "./ui";
import { Modal } from "../views/spaces-util";

// ------------------------------------------------------------------ confirm
type Ask = { title: string; body?: string; ok: string; danger?: boolean; done: (yes: boolean) => void };
let setAsk: ((a: Ask | null) => void) | null = null;
/** In-app confirm. Resolves false when dismissed. */
export function askConfirm(o: { title: string; body?: string; ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((res) => {
    if (!setAsk) return res(false);
    setAsk({ title: o.title, body: o.body, ok: o.ok ?? t("OK"), danger: o.danger, done: res });
  });
}
export function ConfirmHost() {
  const [a, set] = useState<Ask | null>(null);
  useEffect(() => { setAsk = set; return () => { setAsk = null; }; }, []);
  const close = (yes: boolean) => { a?.done(yes); set(null); };
  return (
    <Modal open={!!a} onClose={() => close(false)} width={400} label={a?.title ?? ""}>
      {a && (
        <div className="flex flex-col gap-3 p-5 text-[13px]">
          <div className="text-[15px] font-semibold" dir="auto">{a.title}</div>
          {a.body && <div className="text-muted" dir="auto">{a.body}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" onClick={() => close(false)}>{t("Cancel")}</Button>
            <Button size="sm" variant={a.danger ? "danger" : "primary"} autoFocus onClick={() => close(true)}>{a.ok}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Move to…
let openMove: ((ids: string[]) => void) | null = null;
export const openMoveTo = (ids: string[]) => openMove?.(ids);

/** Substring or subsequence match; lower score = better, null = no match. */
function fuzzy(q: string, s: string): number | null {
  if (!q) return 0;
  const a = q.toLowerCase(), b = s.toLowerCase();
  const at = b.indexOf(a);
  if (at >= 0) return at;
  let j = 0, gaps = 0;
  for (let i = 0; i < b.length && j < a.length; i++) { if (b[i] === a[j]) j++; else if (j) gaps++; }
  return j === a.length ? 100 + gaps : null;
}

export function MoveToHost() {
  const v = useVault();
  const [ids, setIds] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { openMove = (x) => { setIds(x); setQ(""); setSel(0); }; return () => { openMove = null; }; }, []);
  const dests = useMemo(() => {
    const out: { key: string; spaceId: string; folderId: string | null; label: string; path: string; depth: number }[] = [];
    for (const s of v.spaces.filter((x) => !x.deleted)) {
      out.push({ key: s.id, spaceId: s.id, folderId: null, label: s.name, path: s.name, depth: 0 });
      for (const [f, depth] of folderTree(v.folders.filter((x) => x.spaceId === s.id && !x.deleted))) out.push({ key: f.id, spaceId: s.id, folderId: f.id, label: f.name, path: `${s.name} › ${f.name}`, depth: depth + 1 });
    }
    return out;
  }, [v]);
  const current = ids?.length === 1 ? v.byId.get(ids[0]) : null;
  const rows = useMemo(() => (q ? dests.map((d) => [d, fuzzy(q, d.path)] as const).filter((x) => x[1] !== null).sort((a, b) => a[1]! - b[1]!).map((x) => x[0]) : dests), [dests, q]);
  const close = () => setIds(null);
  const go = async (d?: (typeof rows)[number]) => {
    if (!d || !ids) return;
    const before = ids.map((id) => v.byId.get(id)).filter(Boolean).map((n) => [n!.id, n!.spaceId, n!.folderId] as const);
    close();
    for (const id of ids) await moveNote(id, d.spaceId, d.folderId);
    toast(ids.length === 1 ? t("Moved to {name}", { name: d.path }) : t("Moved {n} notes to {name}", { n: ids.length, name: d.path }), { label: t("Undo"), run: () => { for (const [id, s, f] of before) void moveNote(id, s, f); } }, { icon: "check" });
  };
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  return (
    <Modal open={!!ids} onClose={close} width={460} label={t("Move to…")}>
      <div className="flex flex-col text-[13px]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Glyph name="folder" size={15} color="var(--muted)" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder={t("Move to… type a space or folder")} aria-label={t("Move to…")}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); void go(rows[sel]); }
            }} />
        </div>
        <div ref={list} role="listbox" className="flex max-h-[min(360px,60vh)] flex-col overflow-y-auto p-1.5">
          {rows.length === 0 && <div className="px-3 py-6 text-center text-muted">{t("No space or folder matches")}</div>}
          {rows.map((d, i) => {
            const sp = v.spaceMap.get(d.spaceId);
            const here = !!current && current.spaceId === d.spaceId && (current.folderId ?? null) === d.folderId;
            return (
              <button key={d.key} data-i={i} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => void go(d)}
                className={cx("flex h-9 shrink-0 items-center gap-2 rounded-[8px] pe-2 text-start", i === sel && "bg-surface-2")} style={{ paddingInlineStart: 8 + (q ? 0 : d.depth * 14) }}>
                {d.folderId ? <Glyph name="folder" size={14} color="var(--muted)" /> : sp ? <SpaceIcon space={sp} size={14} /> : null}
                <span dir="auto" className="min-w-0 flex-1 truncate">{q ? d.path : d.label}</span>
                {here && <span className="text-[11.5px] text-muted">{t("current")}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 border-t border-line px-4 py-2 text-[11.5px] text-muted"><span dir="ltr">↑↓</span><span>{t("move")}</span><span dir="ltr">↵</span><span>{t("choose")}</span><span dir="ltr">Esc</span><span>{t("cancel")}</span></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Save as template
/** User templates are notes in a top-level space folder named "Templates" (synced like any note). */
export const TEMPLATE_FOLDER = "Templates";
const isTplFolder = (name: string) => name.toLowerCase() === TEMPLATE_FOLDER.toLowerCase();
export const userTemplates = () => {
  const v = getVault();
  const ids = new Set(v.folders.filter((f) => !f.deleted && isTplFolder(f.name)).map((f) => f.id));
  return v.notes.filter((n) => !n.deleted && n.folderId && ids.has(n.folderId));
};
export async function saveAsTemplate(note: { title: string; body: string; type: NoteType; spaceId: string }) {
  const v = getVault();
  const f = v.folders.find((x) => !x.deleted && x.spaceId === note.spaceId && !x.parentId && isTplFolder(x.name)) ?? await createFolder(note.spaceId, null, TEMPLATE_FOLDER);
  await createNote({ type: note.type, title: note.title, body: note.body, spaceId: note.spaceId, folderId: f.id });
  toast(t("Saved as a template in {name}", { name: `${v.spaceMap.get(note.spaceId)?.name ?? ""} › ${TEMPLATE_FOLDER}` }), undefined, { icon: "check" });
}
