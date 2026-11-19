// "New…" entry points (discoverability): the note list "+" (desktop popover), the phone tab bar "+" (bottom sheet) and
// palette commands all go through one host so every kind of note is one click away: note, dashboard, base, PDF note
// (file picker → addPdfFile), canvas or whiteboard (the R4-17 A5 chooser), learning path (New learning path dialog),
// from template. Menu style follows the round-4 menus (surface-2 popover, 13 px rows with a glyph; phone sheet with
// a handle and 52 px rows with glyph tiles, like the "New…" visual sheet).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createNote } from "../lib/actions";
import { openNote, toast, useUI } from "../lib/store";
import { Glyph } from "./Glyph";
import { NewPathDialog } from "./NewPathDialog";
import { NewVisualChooser } from "./NewVisualChooser";
import { TemplatePicker } from "./NoteList";
import { cx } from "./ui";
import { t, tk } from "../lib/i18n";

export type NewKind = "note" | "dashboard" | "base" | "pdf" | "visual" | "path" | "template" | "import";
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";
export const NEW_ITEMS: { k: NewKind; g: string; label: string; hint: string; sc?: string }[] = [
  { k: "note", g: "note", label: tk("New note"), hint: tk("Blank page"), sc: `${MOD}Alt N` },
  { k: "dashboard", g: "dashboard", label: tk("New dashboard"), hint: tk("Charts over sessions, cards and paths") },
  { k: "base", g: "base", label: tk("New base"), hint: tk("Table, board, gallery, calendar of notes") },
  { k: "pdf", g: "pdf", label: tk("New PDF note"), hint: tk("Pick a PDF to read and highlight") },
  { k: "visual", g: "canvas", label: tk("New canvas or whiteboard"), hint: tk("Canvas · whiteboard · diagram") },
  { k: "path", g: "path", label: tk("New learning path"), hint: tk("Combine courses into one roadmap") },
  { k: "template", g: "v-gallery", label: tk("From template"), hint: tk("Lesson, Cornell, deck, post…") },
  { k: "import", g: "export", label: tk("Import…"), hint: tk("Anki, Notion, Obsidian, Markdown") },
];
/** Import dialog (Anki / Notion / Obsidian / Markdown), lazy so its parsers stay out of the main bundle. */
const ImportDialog = lazy(() => import("./ImportDialog"));
export type ImportSource = "anki" | "notion" | "obsidian" | "markdown";
/** Open the Import dialog (optionally on one source). Used by the + menu, Ctrl+K and Import & export. */
export const openImport = (source?: ImportSource | null): void => { dispatchEvent(new CustomEvent("lumen:import", { detail: source ?? null })); };

/** Open the menu: anchored under `el` on desktop, as a bottom sheet when no element is given (phone). */
export const openNewMenu = (el?: HTMLElement | null) => dispatchEvent(new CustomEvent("lumen:new-menu", { detail: el ? el.getBoundingClientRect() : null }));
/** Run one entry directly (palette commands). */
export const runNew = (k: NewKind): void => { dispatchEvent(new CustomEvent("lumen:new", { detail: k })); };

/** Mounted once (App). Owns the menu, the dialogs it opens and the hidden PDF file input. */
export function NewMenuHost() {
  const ui = useUI();
  const [menu, setMenu] = useState<null | { at: DOMRect | null }>(null);
  const [chooser, setChooser] = useState(false);
  const [pathDlg, setPathDlg] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [imp, setImp] = useState<{ source: ImportSource | null } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const folderId = ui.spaceId === "all" ? null : ui.folderId;
  const where = useRef({ spaceId, folderId });
  where.current = { spaceId, folderId };

  const run = async (k: NewKind) => {
    setMenu(null);
    const w = where.current;
    if (k === "note") openNote((await createNote({ spaceId: w.spaceId, folderId: w.folderId })).id, "edit");
    else if (k === "dashboard") openNote((await createNote({ template: "dashboard-path", title: "New dashboard", spaceId: w.spaceId, folderId: w.folderId })).id, "read");
    else if (k === "base") openNote((await createNote({ template: "base", spaceId: w.spaceId, folderId: w.folderId })).id, "read");
    else if (k === "pdf") file.current?.click();
    else if (k === "visual") setChooser(true);
    else if (k === "path") setPathDlg(true);
    else if (k === "import") setImp({ source: null });
    else setTpl(true);
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const m = (e: Event) => setMenu({ at: (e as CustomEvent<DOMRect | null>).detail ?? null });
    const r = (e: Event) => void runRef.current((e as CustomEvent<NewKind>).detail);
    const i = (e: Event) => setImp({ source: (e as CustomEvent<ImportSource | null>).detail });
    addEventListener("lumen:new-menu", m); addEventListener("lumen:new", r); addEventListener("lumen:import", i);
    return () => { removeEventListener("lumen:new-menu", m); removeEventListener("lumen:new", r); removeEventListener("lumen:import", i); };
  }, []);

  const onPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = [...(e.target.files ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    e.target.value = "";
    if (!fl.length) return;
    try {
      const { addPdfFile } = await import("../lib/pdf-note");
      let last = null;
      for (const f of fl) last = await addPdfFile(f, where.current.spaceId, where.current.folderId);
      if (last) openNote(last.id, "read");
    } catch (err) { toast(err instanceof Error ? err.message : t("Upload failed")); }
  };

  return (
    <>
      <input ref={file} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPdf} data-testid="new-pdf-input" />
      {menu && <NewMenu at={menu.at} onPick={(k) => void run(k)} onClose={() => setMenu(null)} />}
      <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
      <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={folderId} />
      {imp && <Suspense fallback={null}><ImportDialog open initial={imp.source} onClose={() => setImp(null)} /></Suspense>}
    </>
  );
}

function NewMenu({ at, onPick, onClose }: { at: DOMRect | null; onPick: (k: NewKind) => void; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % NEW_ITEMS.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s + NEW_ITEMS.length - 1) % NEW_ITEMS.length); }
      else if (e.key === "Enter") { e.preventDefault(); onPick(NEW_ITEMS[selRef.current].k); }
    };
    const down = (e: MouseEvent) => { if (at && !ref.current?.contains(e.target as Node)) onClose(); };
    addEventListener("keydown", key, true);
    const tm = setTimeout(() => addEventListener("mousedown", down), 0);
    return () => { removeEventListener("keydown", key, true); clearTimeout(tm); removeEventListener("mousedown", down); };
  }, [at, onClose, onPick]);
  const selRef = useRef(0);
  selRef.current = sel;

  if (!at) {
    // Phone: bottom sheet
    return (
      <>
        <div className="fixed inset-0 z-40 bg-[rgba(5,6,8,.55)] fade-in" onClick={onClose} />
        <div role="menu" aria-label={t("New")} className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[14px] bg-surface px-4 pb-4 text-ink">
          <div className="flex justify-center pb-2 pt-2.5"><button aria-label={t("Close")} onClick={onClose} className="h-1 w-9 rounded-[2px] bg-line" /></div>
          <span className="pb-2.5 text-[18px] font-[650]">{t("New…")}</span>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {NEW_ITEMS.map((it, i) => (
              <button key={it.k} role="menuitem" onClick={() => onPick(it.k)}
                className="box-border flex min-h-[56px] shrink-0 items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 text-start active:bg-surface-2">
                <Glyph name={it.g} size={22} color={i === 0 ? "var(--accent)" : "var(--text)"} tile={i === 0 ? "var(--accent)" : "var(--text)"} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{t(it.label)}</span>
                  <span className="truncate text-[12.5px] text-muted">{t(it.hint)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }
  const W = 264;
  const left = Math.max(8, Math.min(at.right - W, innerWidth - W - 8));
  return (
    <div ref={ref} role="menu" aria-label={t("New")} className="fade-in fixed z-50 flex flex-col gap-px rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] text-ink shadow-[0_14px_32px_rgba(0,0,0,.45)]" style={{ left, top: at.bottom + 6, width: W }}>
      {NEW_ITEMS.map((it, i) => (
        <button key={it.k} role="menuitem" onMouseEnter={() => setSel(i)} onClick={() => onPick(it.k)}
          className={cx("flex h-[34px] items-center gap-2.5 rounded-[7px] px-2.5 text-start", sel === i && "bg-surface")}>
          <Glyph name={it.g} size={16} color={sel === i ? "var(--accent)" : "var(--muted)"} />
          <span className="min-w-0 flex-1 truncate">{t(it.label)}</span>
          {it.sc && <span dir="ltr" className="font-mono text-[11px] text-muted">{it.sc}</span>}
        </button>
      ))}
    </div>
  );
}
