import { Check, Pilcrow } from "lucide-react";
import { useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { useUI } from "../lib/store";
import { cursorLine } from "./Editor";
import { lastBlock } from "./Preview";
import { getUiDir, setUiDir, useUiDir, type UiDir } from "./ws-dir";
import { cx } from "./ui";

/*
 * ¶ menu (design: Lumen 08 · R2-3A "Auto ⇄"). Direction is per block (dir="auto"); the menu can force the current block
 * LTR or RTL (stored as a trailing `{dir=rtl}` on the block, stripped when rendering), and switch the interface direction.
 */
const SUFFIX = /[ \t]*\{dir=(rtl|ltr)\}[ \t]*$/;

/** [first, last] 0-based line range of the block containing `line`. */
function blockRange(lines: string[], line: number): [number, number] | null {
  if (line < 0 || line >= lines.length || !lines[line].trim()) return null;
  let a = line, z = line;
  while (a > 0 && lines[a - 1].trim()) a--;
  while (z < lines.length - 1 && lines[z + 1].trim()) z++;
  return [a, z];
}
export function blockDir(body: string, line: number): "auto" | "ltr" | "rtl" {
  const lines = body.split("\n");
  const r = blockRange(lines, line);
  if (!r) return "auto";
  return (SUFFIX.exec(lines[r[1]])?.[1] as "ltr" | "rtl" | undefined) ?? "auto";
}
export function setBlockDir(body: string, line: number, dir: "auto" | "ltr" | "rtl") {
  const lines = body.split("\n");
  const r = blockRange(lines, line);
  if (!r) return body;
  lines[r[1]] = lines[r[1]].replace(SUFFIX, "") + (dir === "auto" ? "" : ` {dir=${dir}}`);
  return lines.join("\n");
}

export function DirMenu({ note, compact }: { note: Note; compact?: boolean }) {
  const ui = useUI();
  const uiDir = useUiDir();
  const [open, setOpen] = useState(false);
  const line = ui.mode === "edit" || ui.mode === "split" || ui.mode === "focus" ? cursorLine() : lastBlock.noteId === note.id ? lastBlock.line : -1;
  const cur = line >= 0 ? blockDir(note.body, line) : "auto";
  const label = cur === "auto" ? "Auto" : cur.toUpperCase();
  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] hover:bg-surface-2";
  const set = (d: "auto" | "ltr" | "rtl") => { const l = ui.mode === "edit" || ui.mode === "split" ? cursorLine() : lastBlock.noteId === note.id ? lastBlock.line : -1; if (l >= 0) void updateNote(note.id, { body: setBlockDir(note.body, l, d) }); setOpen(false); };
  return (
    <div className="relative">
      <button title="Text direction" onClick={() => setOpen((o) => !o)} className={cx("flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line px-2 text-[12px] text-muted hover:text-ink", compact && "px-1.5")}>
        <Pilcrow size={13} />{label} ⇄
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full z-40 mt-1 w-64 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">This block</div>
            {(["auto", "ltr", "rtl"] as const).map((d) => (
              <button key={d} disabled={line < 0} className={cx(item, line < 0 && "opacity-50")} onClick={() => set(d)}>
                <span className="w-4">{cur === d && <Check size={14} className="text-accent" />}</span>
                {d === "auto" ? "Auto · first strong letter" : d === "ltr" ? "Force left-to-right" : "Force right-to-left"}
              </button>
            ))}
            {line < 0 && <div className="px-2.5 pb-1 text-[11.5px] text-muted">Click a paragraph (or put the cursor in it) first.</div>}
            <div className="my-1 h-px bg-line" />
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Interface</div>
            {(["auto", "ltr", "rtl"] as UiDir[]).map((d) => (
              <button key={d} className={item} onClick={() => { setUiDir(d); setOpen(false); }}>
                <span className="w-4">{uiDir === d && <Check size={14} className="text-accent" />}</span>
                {d === "auto" ? "Auto (system language)" : d === "ltr" ? "Left-to-right" : "Right-to-left · العربية"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Interface direction as a segmented row (used in the note ⋯ menu). */
export function UiDirRow() {
  const d = useUiDir();
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
      <span className="flex-1 text-muted">Interface</span>
      <div className="flex gap-0.5 rounded-[8px] border border-line bg-surface p-0.5">
        {(["auto", "ltr", "rtl"] as UiDir[]).map((x) => (
          <button key={x} onClick={(e) => { e.stopPropagation(); setUiDir(x); }} className={cx("h-6 rounded-[6px] px-2 text-[12px]", d === x ? "bg-surface-2 font-semibold" : "text-muted")}>{x === "auto" ? "Auto" : x.toUpperCase()}</button>
        ))}
      </div>
    </div>
  );
}
export { getUiDir };
