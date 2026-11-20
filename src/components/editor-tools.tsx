// Small editor UI: Undo / Redo buttons (header on desktop, phone keyboard bar), the editor shortcuts sheet
// (Ctrl/Cmd+/) and the desktop footer with word / character counts (selection-aware, like Obsidian's status bar).
import { Keyboard, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtNum, t, tk } from "../lib/i18n";
import { cx, Sheet } from "./ui";
import { isMac, modKey, runRedo, runUndo, setShortcutsOpener, useEdStats } from "./editor-history";

const undoTip = () => t("Undo ({keys})", { keys: `${modKey}+Z` });
const redoTip = () => (isMac ? t("Redo ({keys})", { keys: "⌘+Shift+Z" }) : t("Redo ({keys})", { keys: "Ctrl+Shift+Z / Ctrl+Y" }));

/** Undo / Redo icon buttons, disabled when there is nothing to undo / redo. `phone` = 40 px touch targets. */
export function UndoRedo({ phone }: { phone?: boolean }) {
  const s = useEdStats();
  const cls = phone
    ? "flex h-10 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink active:bg-surface-2 disabled:opacity-35"
    : "flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent";
  const size = phone ? 19 : 16;
  return (
    <span className="flex shrink-0 items-center" data-act="undo-redo">
      <button type="button" aria-label={t("Undo")} title={undoTip()} disabled={!s.undo} onMouseDown={(e) => e.preventDefault()} onClick={runUndo} className={cls}><Undo2 size={size} className="rtl:-scale-x-100" /></button>
      <button type="button" aria-label={t("Redo")} title={redoTip()} disabled={!s.redo} onMouseDown={(e) => e.preventDefault()} onClick={runRedo} className={cls}><Redo2 size={size} className="rtl:-scale-x-100" /></button>
    </span>
  );
}

let openKeys: (() => void) | null = null;
export const openEditorShortcuts = () => openKeys?.();

const KEYS: [string, string[]][] = [
  [tk("Undo"), ["Mod", "Z"]],
  [tk("Redo"), isMac ? ["Mod", "Shift", "Z"] : ["Ctrl", "Shift", "Z", "/", "Ctrl", "Y"]],
  [tk("Bold"), ["Mod", "B"]],
  [tk("Italic"), ["Mod", "I"]],
  [tk("Inline code"), ["Mod", "E"]],
  [tk("Task"), ["Mod", "Shift", "X"]],
  [tk("Check / uncheck a task"), ["Mod", "Enter"]],
  [tk("Math block"), ["Mod", "Shift", "M"]],
  [tk("Find and replace"), ["Mod", "F"]],
  [tk("Find next / previous"), ["Mod", "G"]],
  [tk("Select next match (multi-cursor)"), ["Mod", "D"]],
  [tk("Select all matches"), ["Mod", "Shift", "L"]],
  [tk("Add a cursor"), ["Mod", "Click"]],
  [tk("Column selection"), ["Alt", "Drag"]],
  [tk("Move block up / down"), ["Alt", "↑ ↓"]],
  [tk("Copy line up / down"), ["Shift", "Alt", "↑ ↓"]],
  [tk("Duplicate block"), ["Mod", "Shift", "D"]],
  [tk("Indent / outdent list"), ["Tab", "/", "Shift", "Tab"]],
  [tk("Continue a list"), ["Enter"]],
  [tk("Go to line"), ["Mod", "Alt", "G"]],
  [tk("Insert a block"), ["/"]],
  [tk("Video timestamp"), ["Alt", "T"]],
  [tk("Keyboard shortcuts"), ["Mod", "/"]],
];

/** Editor shortcuts sheet (Google Docs: Ctrl+/). Mounted once by the editor. */
export function EditorShortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openKeys = () => setOpen(true);
    setShortcutsOpener(() => setOpen((o) => !o));
    return () => { openKeys = null; setShortcutsOpener(null); };
  }, []);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t("Editor shortcuts")}>
      <div className="flex flex-col gap-0.5 text-[13px]">
        {KEYS.map(([l, ks]) => (
          <div key={l} className="flex min-h-[30px] items-center gap-3">
            <span className="flex-1">{t(l)}</span>
            <span className="flex flex-wrap justify-end gap-1" dir="ltr">
              {ks.map((k, i) => k === "/" && ks.length > 1 ? <span key={i} className="px-0.5 text-muted">/</span> : (
                <kbd key={i} className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-line bg-bg px-1.5 font-mono text-[11px] font-medium">{k === "Mod" ? modKey : k === "Click" ? t("Click") : k === "Drag" ? t("Drag") : k}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Desktop status line under the editor: words · characters, or the selection's counts while text is selected. */
export function EditorFooter({ className }: { className?: string }) {
  const s = useEdStats();
  return (
    <div className={cx("flex h-7 shrink-0 items-center gap-3 border-t border-line px-4 text-[11.5px] text-muted", className)} data-act="ed-footer">
      <span className="flex-1" />
      <span className="whitespace-nowrap tabular-nums">
        {s.selChars
          ? t("{w} of {words} words · {c} of {chars} characters", { w: fmtNum(s.selWords), words: fmtNum(s.words), c: fmtNum(s.selChars), chars: fmtNum(s.chars) })
          : t("{words} words · {chars} characters", { words: fmtNum(s.words), chars: fmtNum(s.chars) })}
      </span>
      <button type="button" aria-label={t("Keyboard shortcuts")} title={t("Keyboard shortcuts ({keys})", { keys: `${modKey}+/` })} onMouseDown={(e) => e.preventDefault()} onClick={openEditorShortcuts} className="flex size-6 items-center justify-center rounded-[5px] hover:bg-surface-2 hover:text-ink"><Keyboard size={14} /></button>
    </div>
  );
}
